const mongoose = require('mongoose');
const User = require('../models/User');
const Internship = require('../models/Internship');
const Application = require('../models/Application');
const AccountSuspension = require('../models/AccountSuspension');
const { formatLocalizedDateTime } = require('./dateFormat');
const { suspendedAmong, suspensionHistory, suspensionBlocker } = require('./suspensions');
const { listActions } = require('./adminAudit');
const { deletionBlocker, deletionPreview } = require('./accountDeletion');
const { toCsv } = require('./adminAnalytics');

const ROLES = { candidate: 'Candidate', company: 'Company', recruiter: 'Recruiter', hiring_manager: 'Hiring manager', admin: 'Admin' };
const APPLICATION_STATUSES = ['Submitted', 'Under Review', 'Shortlisted', 'Interview', 'Rejected', 'Hired', 'Withdrawn'];
const PAGE_SIZE = 50;
const CSV_LIMIT = 10000;

const escapeRegExp = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const searchPattern = q => {
    const text = String(q || '').trim().slice(0, 80);
    return text ? new RegExp(escapeRegExp(text), 'i') : null;
};
const pageOf = value => Math.max(1, Math.min(1000, parseInt(value, 10) || 1));
const companyIdOf = user => user.companyId || (user.role === 'company' ? user._id : null);

async function listUsers({ q, role, status, page } = {}, admin = null) {
    const query = {};
    if (ROLES[role]) query.role = role;
    const pattern = searchPattern(q);
    if (pattern) query.$or = [{ name: pattern }, { email: pattern }, { 'companyDetails.companyName': pattern }];
    if (status === 'suspended' || status === 'active') {
        const suspended = await AccountSuspension.find({ active: true }).select('user').lean();
        query._id = { [status === 'suspended' ? '$in' : '$nin']: suspended.map(s => s.user) };
    }

    const current = pageOf(page);
    const [users, total] = await Promise.all([
        User.find(query)
            .sort({ createdAt: -1 })
            .skip((current - 1) * PAGE_SIZE)
            .limit(PAGE_SIZE)
            .select('name email role createdAt location companyDetails.companyName companyDetails.isVerified')
            .lean(),
        User.countDocuments(query)
    ]);
    const suspended = await suspendedAmong(users.map(u => u._id));
    return {
        items: users.map(u => ({
            ...u,
            roleLabel: ROLES[u.role] || u.role,
            suspended: suspended.has(String(u._id)),
            // Deleting still goes through the confirmation panel on the user page.
            deletable: Boolean(admin) && !deletionBlocker(admin, u),
            joinedLabel: u.createdAt ? formatLocalizedDateTime(u.createdAt) : ''
        })),
        page: current,
        pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
        total
    };
}

/** Everything the user page shows, or null if there is no such user. */
async function userDetail(id, admin) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    const user = await User.findById(id)
        .select('name email role createdAt location companyId companyDetails skills education')
        .lean();
    if (!user) return null;

    const [history, actions] = await Promise.all([suspensionHistory(user._id), listActions({ targetId: user._id })]);
    let applications = [];
    let listings = [];
    if (user.role === 'candidate') {
        applications = await Application.find({ candidate: user._id })
            .sort({ createdAt: -1 })
            .limit(20)
            .populate('internship', 'title companyName')
            .select('status createdAt internship')
            .lean();
    } else {
        const companyId = companyIdOf(user);
        if (companyId) {
            listings = await Internship.find({ $or: [{ companyId }, { postedBy: companyId }] })
                .sort({ _id: -1 })
                .limit(20)
                .select('title status vacancies')
                .lean();
            const counts = await Application.aggregate([
                { $match: { internship: { $in: listings.map(l => l._id) } } },
                { $group: { _id: '$internship', n: { $sum: 1 } } }
            ]);
            const countMap = new Map(counts.map(c => [String(c._id), c.n]));
            listings = listings.map(l => ({ ...l, applications: countMap.get(String(l._id)) || 0 }));
        }
    }

    const active = history.find(h => h.active) || null;
    const deleteBlocker = deletionBlocker(admin, user);
    return {
        deletion: { blocker: deleteBlocker, items: deleteBlocker ? [] : await deletionPreview(user) },
        user: { ...user, roleLabel: ROLES[user.role] || user.role, joinedLabel: user.createdAt ? formatLocalizedDateTime(user.createdAt) : '' },
        suspension: active,
        history: history.map(h => ({
            ...h,
            fromLabel: formatLocalizedDateTime(h.createdAt),
            toLabel: h.liftedAt ? formatLocalizedDateTime(h.liftedAt) : ''
        })),
        canSuspend: !suspensionBlocker(admin, user),
        suspendBlocker: suspensionBlocker(admin, user),
        applications: applications.map(a => ({ ...a, appliedLabel: formatLocalizedDateTime(a.createdAt) })),
        listings,
        actions: actions.items
    };
}

/** Application filters shared by the list and the CSV export. */
async function applicationQuery({ status, q, from, to } = {}) {
    const query = {};
    if (APPLICATION_STATUSES.includes(status)) query.status = status;
    const range = {};
    const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(String(from || '')) ? new Date(`${from}T00:00:00+05:30`) : null;
    const toDate = /^\d{4}-\d{2}-\d{2}$/.test(String(to || '')) ? new Date(`${to}T23:59:59.999+05:30`) : null;
    if (fromDate) range.$gte = fromDate;
    if (toDate) range.$lte = toDate;
    if (Object.keys(range).length) query.createdAt = range;

    const pattern = searchPattern(q);
    if (pattern) {
        const [candidates, internships] = await Promise.all([
            User.find({ role: 'candidate', $or: [{ name: pattern }, { email: pattern }] }).select('_id').limit(500).lean(),
            Internship.find({ $or: [{ title: pattern }, { companyName: pattern }] }).select('_id').limit(500).lean()
        ]);
        query.$or = [{ candidate: { $in: candidates.map(c => c._id) } }, { internship: { $in: internships.map(i => i._id) } }];
    }
    return query;
}

const withPeople = cursor => cursor
    .populate('candidate', 'name email location')
    .populate('internship', 'title companyName')
    .select('status createdAt candidate internship matchScore');

async function listApplications(filters = {}) {
    const query = await applicationQuery(filters);
    const current = pageOf(filters.page);
    const [items, total, byStatus] = await Promise.all([
        withPeople(Application.find(query).sort({ createdAt: -1 }).skip((current - 1) * PAGE_SIZE).limit(PAGE_SIZE)).lean(),
        Application.countDocuments(query),
        Application.aggregate([{ $match: query }, { $group: { _id: '$status', n: { $sum: 1 } } }])
    ]);
    const counts = Object.fromEntries(byStatus.map(r => [r._id, r.n]));
    return {
        items: items.map(a => ({ ...a, appliedLabel: formatLocalizedDateTime(a.createdAt) })),
        counts,
        page: current,
        pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
        total
    };
}

async function applicationsCsv(filters = {}) {
    const query = await applicationQuery(filters);
    const rows = await withPeople(Application.find(query).sort({ createdAt: -1 }).limit(CSV_LIMIT)).lean();
    return toCsv([
        { label: 'Applied on', value: a => formatLocalizedDateTime(a.createdAt) },
        { label: 'Status', value: 'status' },
        { label: 'Candidate', value: a => (a.candidate && a.candidate.name) || '' },
        { label: 'Candidate email', value: a => (a.candidate && a.candidate.email) || '' },
        { label: 'State', value: a => (a.candidate && a.candidate.location && a.candidate.location.state) || '' },
        { label: 'Internship', value: a => (a.internship && a.internship.title) || '' },
        { label: 'Company', value: a => (a.internship && a.internship.companyName) || '' },
        { label: 'Match score', value: a => (a.matchScore === undefined || a.matchScore === null ? '' : a.matchScore) }
    ], rows);
}

module.exports = {
    ROLES,
    APPLICATION_STATUSES,
    PAGE_SIZE,
    CSV_LIMIT,
    listUsers,
    userDetail,
    applicationQuery,
    listApplications,
    applicationsCsv
};
