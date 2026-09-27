const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const { isAuthenticated, authorize } = require('../middleware/auth');
const User = require('../models/User');
const Internship = require('../models/Internship');
const Application = require('../models/Application');
const Notification = require('../models/Notification');
const Announcement = require('../models/Announcement');
const AccountSuspension = require('../models/AccountSuspension');
const AdminAuditLog = require('../models/AdminAuditLog');
const { checkPmisEligibility } = require('../utils/pmisEligibility');
const {
    CONSOLE_ROLES,
    escapeRegex,
    normalizedText,
    parseRange,
    rangeWindow,
    percentageChange,
    normalizeApplicationStatus,
    buildFunnel,
    listingRiskFlags,
    isSuspensionEligible,
    toCsv,
    safeJson
} = require('../utils/adminConsole');

const requireAdmin = [isAuthenticated, authorize('admin')];
const APPLICATION_STATUSES = ['Submitted', 'Under Review', 'Shortlisted', 'Interview', 'Rejected', 'Hired', 'Withdrawn', 'pending'];

function validId(value) {
    return typeof value === 'string' && mongoose.Types.ObjectId.isValid(value);
}

function consoleError(req, res, message, path = '/admin/console') {
    if (req.flash) req.flash('error_msg', message);
    return res.redirect(path);
}

function consoleSuccess(req, res, message) {
    if (req.flash) req.flash('success_msg', message);
}

function audit(actor, action, targetType, targetId, reason = '', metadata = {}) {
    return AdminAuditLog.create({ actor, action, targetType, targetId, reason, metadata });
}

function audienceRoles(audience) {
    if (audience === 'candidates') return ['candidate'];
    if (audience === 'companies') return ['company'];
    return ['candidate', 'company'];
}

async function sendAnnouncementNotifications(announcement) {
    const users = await User.find({ role: { $in: audienceRoles(announcement.audience) } }).select('_id role').lean();
    if (!users.length) return 0;

    const notifications = users.map(user => ({
        ...(user.role === 'company' ? { companyId: user._id } : { recipient: user._id }),
        // Existing notification categories are intentionally reused so this
        // console stays independent of the legacy Notification schema.
        type: 'application_status',
        title: announcement.title,
        message: announcement.message,
        link: '/',
        metadata: { announcementId: announcement._id }
    }));
    await Notification.insertMany(notifications, { ordered: false });
    return notifications.length;
}

function periodMatch(field, start, end) {
    return { [field]: { $gte: start, $lt: end } };
}

async function periodTotal(model, query, field, range) {
    const [current, previous] = await Promise.all([
        model.countDocuments({ ...query, ...periodMatch(field, range.start, range.end) }),
        model.countDocuments({ ...query, ...periodMatch(field, range.previousStart, range.previousEnd) })
    ]);
    return { current, previous, change: percentageChange(current, previous) };
}

function dateLabel(date) {
    return new Date(date).toISOString().slice(0, 10);
}

function fillDaily(rows, start, end) {
    const values = new Map(rows.map(row => [row._id, row.count]));
    const points = [];
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    const last = new Date(end);
    last.setHours(0, 0, 0, 0);
    while (cursor < last) {
        const key = dateLabel(cursor);
        points.push({ date: key, count: values.get(key) || 0 });
        cursor.setDate(cursor.getDate() + 1);
    }
    return points;
}

async function buildAnalytics(days) {
    const range = rangeWindow(days);
    const [candidates, companies, listings, applications, hires, signupRows, applicationRows, statusRows, stateRows, topListings, listingSkills, candidateSkillRows, candidatesForPmis] = await Promise.all([
        periodTotal(User, { role: 'candidate' }, 'createdAt', range),
        periodTotal(User, { role: 'company' }, 'createdAt', range),
        periodTotal(Internship, {}, 'createdAt', range),
        periodTotal(Application, {}, 'createdAt', range),
        periodTotal(Application, { status: 'Hired' }, 'statusUpdatedAt', range),
        User.aggregate([
            { $match: { role: { $in: ['candidate', 'company'] }, ...periodMatch('createdAt', range.start, range.end) } },
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } }
        ]),
        Application.aggregate([
            { $match: periodMatch('createdAt', range.start, range.end) },
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } }
        ]),
        Application.aggregate([{ $match: periodMatch('createdAt', range.start, range.end) }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
        Application.aggregate([
            { $match: periodMatch('createdAt', range.start, range.end) },
            { $lookup: { from: 'users', localField: 'candidate', foreignField: '_id', as: 'candidateRecord' } },
            { $unwind: { path: '$candidateRecord', preserveNullAndEmptyArrays: true } },
            { $group: { _id: { $ifNull: ['$candidateRecord.location.state', 'Not provided'] }, count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } }, { $limit: 10 }
        ]),
        Application.aggregate([
            { $match: periodMatch('createdAt', range.start, range.end) },
            { $group: { _id: '$internship', applications: { $sum: 1 } } },
            { $sort: { applications: -1 } }, { $limit: 10 },
            { $lookup: { from: 'internships', localField: '_id', foreignField: '_id', as: 'listing' } },
            { $unwind: { path: '$listing', preserveNullAndEmptyArrays: true } },
            { $project: { _id: 0, title: { $ifNull: ['$listing.title', 'Deleted listing'] }, companyName: { $ifNull: ['$listing.companyName', 'Unknown company'] }, applications: 1 } }
        ]),
        Internship.distinct('requiredSkills', { status: { $ne: 'draft' }, ...periodMatch('createdAt', range.start, range.end) }),
        User.aggregate([
            { $match: { role: 'candidate', ...periodMatch('createdAt', range.start, range.end) } },
            { $project: { combinedSkills: { $concatArrays: [{ $ifNull: ['$skills', []] }, { $ifNull: ['$skillProfiles.name', []] }] } } },
            { $unwind: '$combinedSkills' }, { $group: { _id: { $toLower: '$combinedSkills' }, count: { $sum: 1 } } }
        ]),
        User.find({ role: 'candidate', ...periodMatch('createdAt', range.start, range.end) })
            .select('age familyIncome qualification education enrollmentStatus employmentStatus').lean()
    ]);

    const statusCounts = {};
    let rejected = 0;
    let withdrawn = 0;
    statusRows.forEach(row => {
        const status = normalizeApplicationStatus(row._id);
        if (status === 'Rejected') rejected = row.count;
        else if (status === 'Withdrawn') withdrawn = row.count;
        else statusCounts[status] = (statusCounts[status] || 0) + row.count;
    });
    const candidateSkills = new Map(candidateSkillRows.map(row => [row._id, row.count]));
    const skillsGap = [...new Set(listingSkills.map(skill => String(skill || '').trim().toLowerCase()).filter(Boolean))]
        .map(skill => ({ skill, candidates: candidateSkills.get(skill) || 0 }))
        .sort((a, b) => a.candidates - b.candidates || a.skill.localeCompare(b.skill)).slice(0, 10);
    const pmis = candidatesForPmis.reduce((summary, candidate) => {
        summary[checkPmisEligibility(candidate).status] += 1;
        return summary;
    }, { eligible: 0, ineligible: 0, incomplete: 0 });

    return {
        days,
        totals: { candidates, companies, listings, applications, hires },
        daily: {
            labels: fillDaily(signupRows, range.start, range.end).map(point => point.date),
            signups: fillDaily(signupRows, range.start, range.end).map(point => point.count),
            applications: fillDaily(applicationRows, range.start, range.end).map(point => point.count)
        },
        funnel: buildFunnel(statusCounts),
        rejected,
        withdrawn,
        states: stateRows.map(row => ({ state: row._id, count: row.count })),
        topListings,
        skillsGap,
        pmis
    };
}

async function activeSuspensionIds() {
    return AccountSuspension.find({ isActive: true }).distinct('subject');
}

async function listUsers(query) {
    const search = normalizedText(query.search, 100);
    const role = CONSOLE_ROLES.includes(query.role) ? query.role : '';
    const state = ['active', 'suspended'].includes(query.status) ? query.status : '';
    const filter = {};
    if (role) filter.role = role;
    if (search) {
        const expression = new RegExp(escapeRegex(search), 'i');
        filter.$or = [{ name: expression }, { email: expression }];
    }
    if (state) {
        const suspendedIds = await activeSuspensionIds();
        filter._id = state === 'suspended' ? { $in: suspendedIds } : { $nin: suspendedIds };
    }
    const users = await User.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    const suspended = new Set((await activeSuspensionIds()).map(String));
    return users.map(user => ({ ...user, consoleStatus: suspended.has(String(user._id)) ? 'suspended' : 'active' }));
}

async function listApplications(query) {
    const status = APPLICATION_STATUSES.includes(query.status) ? query.status : '';
    const search = normalizedText(query.search, 100).toLowerCase();
    const applications = await Application.find(status ? { status } : {})
        .sort({ appliedAt: -1 }).limit(500)
        .populate('candidate', 'name email location.state')
        .populate('internship', 'title companyName').lean();
    return applications.filter(application => {
        if (!search) return true;
        return [application.candidate?.name, application.candidate?.email, application.internship?.title, application.internship?.companyName]
            .some(value => String(value || '').toLowerCase().includes(search));
    });
}

// Mounted at the app root. It supplies public banners and signs a suspended
// account out before any protected route can act on its session.
router.use(async (req, res, next) => {
    try {
        const now = new Date();
        res.locals.activeAnnouncements = await Announcement.find({ startsAt: { $lte: now }, endsAt: { $gte: now } })
            .sort({ tone: 1, startsAt: -1 }).lean();

        if (!req.user || ['admin', 'company'].includes(req.user.role)) return next();
        const suspension = await AccountSuspension.findOne({ subject: req.user._id, isActive: true }).lean();
        if (!suspension) return next();

        const finish = error => {
            if (error) return next(error);
            const redirect = () => {
                if (req.flash) req.flash('error_msg', 'Your account has been suspended.');
                return res.redirect('/auth/login');
            };
            return req.session?.destroy ? req.session.destroy(() => redirect()) : redirect();
        };
        return typeof req.logout === 'function' ? req.logout(finish) : finish();
    } catch (error) {
        // Banners and the separate console tables must not make the public
        // application unavailable during a transient database failure.
        console.error('Admin console context error:', error);
        return next();
    }
});

router.get(['/admin/console', '/admin/overview'], ...requireAdmin, async (req, res) => {
    try {
        const analytics = await buildAnalytics(parseRange(req.query.range));
        return res.render('admin-console/overview', { analytics, safeJson });
    } catch (error) {
        return res.status(500).render('extras/error', { message: 'Unable to load console analytics.', error: {} });
    }
});

router.get(['/admin/console/users', '/admin/users'], ...requireAdmin, async (req, res) => {
    try {
        const users = await listUsers(req.query);
        return res.render('admin-console/users', { users, filters: { search: normalizedText(req.query.search, 100), role: CONSOLE_ROLES.includes(req.query.role) ? req.query.role : '', status: ['active', 'suspended'].includes(req.query.status) ? req.query.status : '' }, roles: CONSOLE_ROLES });
    } catch (error) {
        return res.status(500).render('extras/error', { message: 'Unable to load users.', error: {} });
    }
});

router.get(['/admin/console/users/:id', '/admin/users/:id'], ...requireAdmin, async (req, res) => {
    if (!validId(req.params.id)) return consoleError(req, res, 'Invalid user ID.', '/admin/console/users');
    try {
        const user = await User.findById(req.params.id).lean();
        if (!user) return consoleError(req, res, 'User not found.', '/admin/console/users');
        const suspension = await AccountSuspension.findOne({ subject: user._id, isActive: true }).lean();
        const applications = user.role === 'candidate'
            ? await Application.find({ candidate: user._id }).sort({ appliedAt: -1 }).populate('internship', 'title companyName').lean()
            : [];
        const listings = user.role === 'company'
            ? await Internship.find({ $or: [{ companyId: user._id }, { companyId: null, postedBy: user._id }] }).sort({ createdAt: -1 }).lean()
            : [];
        return res.render('admin-console/user-detail', { user, suspension, applications, listings, canSuspend: isSuspensionEligible(user, req.user._id) });
    } catch (error) {
        return res.status(500).render('extras/error', { message: 'Unable to load user details.', error: {} });
    }
});

router.post(['/admin/console/users/:id/suspend', '/admin/users/:id/suspend'], ...requireAdmin, async (req, res) => {
    if (!validId(req.params.id)) return consoleError(req, res, 'Invalid user ID.', '/admin/console/users');
    const reason = normalizedText(req.body.reason, 1000);
    if (!reason) return consoleError(req, res, 'A suspension reason is required.', `/admin/console/users/${req.params.id}`);
    try {
        const user = await User.findById(req.params.id);
        if (!isSuspensionEligible(user, req.user._id)) return consoleError(req, res, 'Admins and company owner accounts cannot be suspended here.', `/admin/console/users/${req.params.id}`);
        const now = new Date();
        await AccountSuspension.findOneAndUpdate(
            { subject: user._id },
            { $set: { suspendedBy: req.user._id, reason, isActive: true, suspendedAt: now, reactivatedAt: undefined, reactivatedBy: undefined } },
            { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
        );
        await audit(req.user._id, 'USER_SUSPENDED', 'User', user._id, reason, { role: user.role });
        consoleSuccess(req, res, `${user.name} has been suspended and will be signed out on the next request.`);
        return res.redirect(`/admin/console/users/${user._id}`);
    } catch (error) {
        return consoleError(req, res, 'Unable to suspend this account.', `/admin/console/users/${req.params.id}`);
    }
});

router.post(['/admin/console/users/:id/reactivate', '/admin/users/:id/reactivate'], ...requireAdmin, async (req, res) => {
    if (!validId(req.params.id)) return consoleError(req, res, 'Invalid user ID.', '/admin/console/users');
    try {
        const user = await User.findById(req.params.id);
        const suspension = user ? await AccountSuspension.findOneAndUpdate(
            { subject: user._id, isActive: true },
            { $set: { isActive: false, reactivatedAt: new Date(), reactivatedBy: req.user._id } },
            { new: true }
        ) : null;
        if (!user || !suspension) return consoleError(req, res, 'No active suspension was found.', `/admin/console/users/${req.params.id}`);
        await audit(req.user._id, 'USER_REACTIVATED', 'User', user._id, '', { role: user.role });
        consoleSuccess(req, res, `${user.name} has been reactivated.`);
        return res.redirect(`/admin/console/users/${user._id}`);
    } catch (error) {
        return consoleError(req, res, 'Unable to reactivate this account.', `/admin/console/users/${req.params.id}`);
    }
});

router.get(['/admin/console/listings', '/admin/listings'], ...requireAdmin, async (req, res) => {
    try {
        const search = normalizedText(req.query.search, 100);
        const status = ['published', 'paused', 'closed', 'draft'].includes(req.query.status) ? req.query.status : '';
        const filter = status ? { status } : {};
        if (search) {
            const expression = new RegExp(escapeRegex(search), 'i');
            filter.$or = [{ title: expression }, { companyName: expression }];
        }
        const listings = await Internship.find(filter).sort({ createdAt: -1 }).limit(200).populate('companyId', 'companyDetails.isVerified').lean();
        return res.render('admin-console/listings', { listings: listings.map(listing => ({ ...listing, riskFlags: listingRiskFlags(listing) })), filters: { search, status } });
    } catch (error) {
        return res.status(500).render('extras/error', { message: 'Unable to load listings.', error: {} });
    }
});

router.post(['/admin/console/listings/:id/moderate', '/admin/listings/:id/moderate'], ...requireAdmin, async (req, res) => {
    if (!validId(req.params.id)) return consoleError(req, res, 'Invalid listing ID.', '/admin/console/listings');
    const action = ['pause', 'close', 'restore'].includes(req.body.action) ? req.body.action : '';
    const reason = normalizedText(req.body.reason, 1000);
    if (!action || !reason) return consoleError(req, res, 'Choose a moderation action and provide a reason.', '/admin/console/listings');
    try {
        const listing = await Internship.findById(req.params.id);
        if (!listing) return consoleError(req, res, 'Listing not found.', '/admin/console/listings');
        const statusByAction = { pause: 'paused', close: 'closed', restore: 'published' };
        listing.status = statusByAction[action];
        listing.isPaused = action === 'pause';
        await listing.save();
        const companyId = listing.companyId || listing.postedBy;
        if (companyId) {
            await Notification.create({
                companyId,
                type: 'new_application',
                title: `Listing ${action === 'restore' ? 'restored' : `${action}d`} by platform moderation`,
                message: `“${listing.title || 'Your listing'}” was ${action === 'restore' ? 'restored' : `${action}d`} by an administrator. Reason: ${reason}`,
                link: '/company/dashboard',
                internship: listing._id
            });
        }
        const actionName = { pause: 'LISTING_PAUSED', close: 'LISTING_CLOSED', restore: 'LISTING_RESTORED' }[action];
        await audit(req.user._id, actionName, 'Internship', listing._id, reason, { status: listing.status });
        consoleSuccess(req, res, `Listing ${action === 'restore' ? 'restored' : `${action}d`} successfully.`);
        return res.redirect('/admin/console/listings');
    } catch (error) {
        return consoleError(req, res, 'Unable to moderate this listing.', '/admin/console/listings');
    }
});

router.get(['/admin/console/applications', '/admin/applications'], ...requireAdmin, async (req, res) => {
    try {
        const applications = await listApplications(req.query);
        return res.render('admin-console/applications', { applications, filters: { search: normalizedText(req.query.search, 100), status: APPLICATION_STATUSES.includes(req.query.status) ? req.query.status : '' }, statuses: APPLICATION_STATUSES });
    } catch (error) {
        return res.status(500).render('extras/error', { message: 'Unable to load applications.', error: {} });
    }
});

router.get('/admin/console/export/:kind', ...requireAdmin, async (req, res) => {
    const kind = ['users', 'applications'].includes(req.params.kind) ? req.params.kind : '';
    if (!kind) return res.status(404).send('Unknown export.');
    try {
        const source = kind === 'users' ? await listUsers(req.query) : await listApplications(req.query);
        const headers = kind === 'users'
            ? ['Name', 'Email', 'Role', 'Status', 'Joined']
            : ['Candidate', 'Candidate email', 'Listing', 'Company', 'Status', 'Applied at'];
        const rows = kind === 'users'
            ? source.map(user => [user.name, user.email, user.role, user.consoleStatus, user.createdAt?.toISOString()])
            : source.map(application => [application.candidate?.name, application.candidate?.email, application.internship?.title, application.internship?.companyName, normalizeApplicationStatus(application.status), application.appliedAt?.toISOString()]);
        res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="internpilot-${kind}.csv"` });
        return res.send(`\uFEFF${toCsv(headers, rows)}`);
    } catch (error) {
        return res.status(500).send('Unable to export this data.');
    }
});

router.get(['/admin/console/announcements', '/admin/announcements'], ...requireAdmin, async (req, res) => {
    try {
        const announcements = await Announcement.find().sort({ startsAt: -1 }).limit(100).lean();
        return res.render('admin-console/announcements', { announcements, now: new Date() });
    } catch (error) {
        return res.status(500).render('extras/error', { message: 'Unable to load announcements.', error: {} });
    }
});

router.post(['/admin/console/announcements', '/admin/announcements'], ...requireAdmin, async (req, res) => {
    const title = normalizedText(req.body.title, 140);
    const message = normalizedText(req.body.message, 2000);
    const audience = ['all', 'candidates', 'companies'].includes(req.body.audience) ? req.body.audience : 'all';
    const tone = ['info', 'warning', 'success'].includes(req.body.tone) ? req.body.tone : 'info';
    const startsAt = new Date(req.body.startsAt);
    const endsAt = new Date(req.body.endsAt);
    if (!title || !message || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
        return consoleError(req, res, 'Provide a title, message, and a valid time window.', '/admin/console/announcements');
    }
    try {
        const announcement = await Announcement.create({ title, message, audience, tone, startsAt, endsAt, sendInApp: req.body.sendInApp === 'on', createdBy: req.user._id });
        let notificationCount = 0;
        if (announcement.sendInApp) {
            notificationCount = await sendAnnouncementNotifications(announcement);
            announcement.inAppSentAt = new Date();
            await announcement.save();
        }
        await audit(req.user._id, 'ANNOUNCEMENT_CREATED', 'Announcement', announcement._id, '', { audience, tone, notificationCount });
        consoleSuccess(req, res, 'Announcement created successfully.');
        return res.redirect('/admin/console/announcements');
    } catch (error) {
        return consoleError(req, res, 'Unable to create this announcement.', '/admin/console/announcements');
    }
});

router.post(['/admin/console/announcements/:id/delete', '/admin/announcements/:id/delete'], ...requireAdmin, async (req, res) => {
    if (!validId(req.params.id)) return consoleError(req, res, 'Invalid announcement ID.', '/admin/console/announcements');
    try {
        const announcement = await Announcement.findByIdAndDelete(req.params.id);
        if (!announcement) return consoleError(req, res, 'Announcement not found.', '/admin/console/announcements');
        await audit(req.user._id, 'ANNOUNCEMENT_DELETED', 'Announcement', announcement._id, '', { title: announcement.title });
        consoleSuccess(req, res, 'Announcement removed.');
        return res.redirect('/admin/console/announcements');
    } catch (error) {
        return consoleError(req, res, 'Unable to remove this announcement.', '/admin/console/announcements');
    }
});

router.get(['/admin/console/audit-log', '/admin/console/audit', '/admin/audit'], ...requireAdmin, async (req, res) => {
    try {
        const entries = await AdminAuditLog.find().sort({ createdAt: -1 }).limit(200).populate('actor', 'name email').lean();
        return res.render('admin-console/audit-log', { entries });
    } catch (error) {
        return res.status(500).render('extras/error', { message: 'Unable to load the audit log.', error: {} });
    }
});

module.exports = router;
module.exports.buildAnalytics = buildAnalytics;
module.exports.listUsers = listUsers;
