const mongoose = require('mongoose');
const Grievance = require('../models/Grievance');
const Notification = require('../models/Notification');
const Application = require('../models/Application');
const Internship = require('../models/Internship');
const { COMPANY_ROLES } = require('../middleware/companyAccess');
const { formatLocalizedDateTime } = require('./dateFormat');

const { GrievanceCounter } = Grievance;


const typePath = Notification.schema.path('type');
if (typePath && Array.isArray(typePath.enumValues) && !typePath.enumValues.includes('grievance_update')) {
    typePath.enum('grievance_update');
}


const CATEGORIES = {
    fees: 'Demand for fees or a security deposit',
    stipend: 'Stipend or grant not paid',
    misleading: 'Misleading internship details',
    account: 'Verification, profile or eligibility',
    application: 'Application or selection process',
    technical: 'Technical problem on the portal',
    other: 'Something else'
};

const STATUS = {
    open: { label: 'Open', badge: 'bg-sky-50 text-sky-700 border-sky-200' },
    in_review: { label: 'In review', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    resolved: { label: 'Resolved', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    closed: { label: 'Closed', badge: 'bg-slate-100 text-slate-600 border-slate-200' }
};


const TIERS = {
    1: { label: 'Tier 1', desk: 'Internal Helpdesk', hours: 48, sla: '48 hours' },
    2: { label: 'Tier 2', desk: 'Grievance Redressal Officer', workingDays: 7, sla: '7 working days' },
    3: { label: 'Tier 3', desk: 'CPGRAMS escalation', workingDays: 15, sla: '15 working days' }
};

const LIMITS = { subject: 120, description: 4000, message: 2000, perDay: 5, reopenDays: 7 };
const ACTIVE = ['open', 'in_review'];
const TICKET_PATTERN = /^GRV-\d{4}-\d{6}$/;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const IST_OFFSET_MS = 330 * 60 * 1000;


const istWeekday = time => new Date(time + IST_OFFSET_MS).getUTCDay();


function addWorkingDays(from, days) {
    let time = new Date(from).getTime();
    let added = 0;
    while (added < days) {
        time += DAY_MS;
        const weekday = istWeekday(time);
        if (weekday !== 0 && weekday !== 6) added += 1;
    }
    return new Date(time);
}

function dueDateFor(tier, from = new Date()) {
    const rule = TIERS[tier] || TIERS[1];
    if (rule.hours) return new Date(new Date(from).getTime() + rule.hours * HOUR_MS);
    return addWorkingDays(from, rule.workingDays);
}

const isActive = status => ACTIVE.includes(status);
const isOverdue = (g, now = new Date()) => Boolean(g && isActive(g.status) && g.dueAt && new Date(g.dueAt) < now);
const idOf = value => String((value && value._id) || value || '');


function applyEscalations(g, now = new Date()) {
    const moved = [];
    while (isOverdue(g, now) && g.tier < 3) {
        const missed = new Date(g.dueAt);
        g.tier += 1;
        g.dueAt = dueDateFor(g.tier, missed);
        g.updates.push({
            kind: 'escalated',
            byRole: 'system',
            tier: g.tier,
            message: `Not resolved in time, so it moved to ${TIERS[g.tier].label} (${TIERS[g.tier].desk}).`,
            at: missed
        });
        moved.push(g.tier);
    }
    return moved;
}


function applyAutoClose(g, now = new Date()) {
    if (g.status !== 'resolved' || !g.resolvedAt) return false;
    const windowEnds = new Date(new Date(g.resolvedAt).getTime() + LIMITS.reopenDays * DAY_MS);
    if (now <= windowEnds) return false;
    g.status = 'closed';
    g.updates.push({
        kind: 'status',
        byRole: 'system',
        status: 'closed',
        message: `Closed automatically ${LIMITS.reopenDays} days after it was resolved.`,
        at: windowEnds
    });
    return true;
}

function canReopen(g, now = new Date()) {
    return Boolean(g && g.status === 'resolved' && (g.reopenCount || 0) < 1 && g.resolvedAt &&
        now - new Date(g.resolvedAt) <= LIMITS.reopenDays * DAY_MS);
}


function canView(user, g) {
    if (!user || !g) return false;
    if (user.role === 'admin') return true;
    return idOf(g.raisedBy) === idOf(user);
}


function raiserRoleFor(user) {
    if (!user) return null;
    if (user.role === 'candidate') return 'candidate';
    if (COMPANY_ROLES.includes(user.role)) return 'company';
    return null;
}

const companyIdOf = user => (user && (user.companyId || (user.role === 'company' ? user._id : null))) || null;

function validateGrievanceInput(body = {}) {
    const category = String(body.category || '');
    const subject = String(body.subject || '').trim();
    const description = String(body.description || '').trim();
    const link = String(body.link || '');
    const errors = [];

    if (!CATEGORIES[category]) errors.push('Choose what the grievance is about.');
    if (subject.length < 5) errors.push('Add a subject of at least 5 characters.');
    if (subject.length > LIMITS.subject) errors.push(`Keep the subject under ${LIMITS.subject} characters.`);
    if (description.length < 20) errors.push('Describe the problem in at least 20 characters.');
    if (description.length > LIMITS.description) errors.push(`Keep the description under ${LIMITS.description} characters.`);

    return { value: { category, subject, description, link }, errors };
}

function validateMessage(text, { required = true } = {}) {
    const message = String(text || '').trim();
    if (required && !message) return { error: 'Write a message first.' };
    if (message.length > LIMITS.message) return { error: `Keep the message under ${LIMITS.message} characters.` };
    return { message };
}

const formatTicket = (year, seq) => `GRV-${year}-${String(seq).padStart(6, '0')}`;


async function nextTicket(now = new Date()) {
    const year = new Date(now.getTime() + IST_OFFSET_MS).getUTCFullYear();
    const counter = await GrievanceCounter.findOneAndUpdate(
        { _id: `grievance-${year}` },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: 'after' }
    );
    return formatTicket(year, counter.seq);
}

const ownListingsQuery = companyId => ({ $or: [{ companyId }, { postedBy: companyId }] });


async function linkOptions(user) {
    const role = raiserRoleFor(user);
    if (role === 'candidate') {
        const applications = await Application.find({ candidate: user._id })
            .sort({ appliedAt: -1 })
            .limit(50)
            .populate('internship', 'title companyName')
            .lean();
        return applications
            .filter(a => a.internship)
            .map(a => ({ value: `application:${a._id}`, label: `${a.internship.title} (${a.internship.companyName || 'Company'})` }));
    }
    if (role === 'company') {
        const companyId = companyIdOf(user);
        if (!companyId) return [];
        const listings = await Internship.find(ownListingsQuery(companyId)).sort({ createdAt: -1 }).limit(50).select('title').lean();
        return listings.map(i => ({ value: `internship:${i._id}`, label: i.title }));
    }
    return [];
}


async function resolveLink(user, role, link) {
    const [kind, id] = String(link || '').split(':');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return {};
    if (role === 'candidate' && kind === 'application') {
        const application = await Application.findOne({ _id: id, candidate: user._id }).select('internship').lean();
        return application ? { application: application._id, internship: application.internship } : {};
    }
    if (role === 'company' && kind === 'internship') {
        const companyId = companyIdOf(user);
        const internship = companyId
            ? await Internship.findOne({ _id: id, ...ownListingsQuery(companyId) }).select('_id').lean()
            : null;
        return internship ? { internship: internship._id } : {};
    }
    return {};
}


async function notifyRaiser(g, title, message) {
    try {
        const link = `/grievances/${g.ticket}`;
        if (g.raiserRole === 'company' && g.companyId) {
            await Notification.create({
                companyId: g.companyId,
                type: 'grievance_update',
                title: 'Grievance update',
                message: `There is an update on grievance ${g.ticket}.`,
                link
            });
        } else {
            await Notification.create({ recipient: g.raisedBy, type: 'grievance_update', title, message, link });
        }
    } catch (err) {
        console.error('Could not send grievance notification:', err);
    }
}

async function createGrievance(user, body, now = new Date()) {
    const role = raiserRoleFor(user);
    if (!role) return { errors: ['Only candidates and companies can raise a grievance here.'], value: {} };

    const { value, errors } = validateGrievanceInput(body);
    if (errors.length) return { errors, value };

    const recent = await Grievance.countDocuments({ raisedBy: user._id, createdAt: { $gte: new Date(now.getTime() - DAY_MS) } });
    if (recent >= LIMITS.perDay) {
        return {
            errors: [`You can raise up to ${LIMITS.perDay} grievances a day. Add a reply to one you already raised instead.`],
            value,
            limited: true
        };
    }

    const links = await resolveLink(user, role, value.link);
    const grievance = await Grievance.create({
        ticket: await nextTicket(now),
        raisedBy: user._id,
        raiserRole: role,
        companyId: role === 'company' ? companyIdOf(user) : undefined,
        category: value.category,
        subject: value.subject,
        description: value.description,
        ...links,
        status: 'open',
        tier: 1,
        dueAt: dueDateFor(1, now),
        updates: [{ kind: 'created', by: user._id, byRole: 'raiser', at: now }]
    });
    return { grievance };
}


async function refresh(g, now = new Date()) {
    const moved = applyEscalations(g, now);
    const closed = applyAutoClose(g, now);
    if (moved.length || closed) {
        await g.save();
        if (moved.length) {
            const tier = TIERS[g.tier];
            await notifyRaiser(g, `Grievance ${g.ticket} moved to ${tier.label}`,
                `It wasn't resolved in time, so it is now with the ${tier.desk}.`);
        }
    }
    return g;
}

async function addRaiserReply(g, user, text, now = new Date()) {
    if (!isActive(g.status)) return { error: 'This grievance is no longer open.' };
    const { message, error } = validateMessage(text);
    if (error) return { error };
    g.updates.push({ kind: 'reply', by: user._id, byRole: 'raiser', message, at: now });
    await g.save();
    return { ok: true };
}

async function reopenGrievance(g, user, text, now = new Date()) {
    if (!canReopen(g, now)) return { error: `A resolved grievance can be reopened once, within ${LIMITS.reopenDays} days.` };
    const { message, error } = validateMessage(text);
    if (error) return { error: "Tell us why the resolution didn't fix it." };
    g.status = 'open';
    g.reopenCount = (g.reopenCount || 0) + 1;
    g.resolvedAt = undefined;
    g.dueAt = dueDateFor(g.tier, now);
    g.updates.push({ kind: 'reopened', by: user._id, byRole: 'raiser', status: 'open', message, at: now });
    await g.save();
    return { ok: true };
}


async function adminRespond(g, admin, { message: text, status } = {}, now = new Date()) {
    if (g.status === 'closed') return { error: 'This grievance is closed.' };
    const nextStatus = STATUS[status] ? status : g.status;
    const changing = nextStatus !== g.status;
    const { message, error } = validateMessage(text, { required: !changing || nextStatus === 'resolved' });
    if (error) return { error: nextStatus === 'resolved' && !String(text || '').trim() ? 'Add a resolution note for the raiser.' : error };

    if (message) g.updates.push({ kind: 'response', by: admin._id, byRole: 'admin', message, at: now });
    if (changing) {
        g.status = nextStatus;
        if (nextStatus === 'resolved') g.resolvedAt = now;
        if (isActive(nextStatus)) g.resolvedAt = undefined;
        g.updates.push({ kind: 'status', by: admin._id, byRole: 'admin', status: nextStatus, at: now });
    }
    await g.save();

    const title = nextStatus === 'resolved' ? `Grievance ${g.ticket} resolved` : `Update on grievance ${g.ticket}`;
    const note = nextStatus === 'resolved'
        ? `It was marked resolved. You can reopen it within ${LIMITS.reopenDays} days if the problem isn't fixed.`
        : (message ? 'The grievance team replied to your grievance.' : `Its status is now: ${STATUS[nextStatus].label}.`);
    await notifyRaiser(g, title, note);
    return { ok: true };
}

async function adminEscalate(g, admin, now = new Date()) {
    if (!isActive(g.status)) return { error: 'Only open grievances can be escalated.' };
    if (g.tier >= 3) return { error: 'This grievance is already at Tier 3.' };
    g.tier += 1;
    g.dueAt = dueDateFor(g.tier, now);
    const tier = TIERS[g.tier];
    g.updates.push({ kind: 'escalated', by: admin._id, byRole: 'admin', tier: g.tier, message: `Escalated to ${tier.label} (${tier.desk}).`, at: now });
    await g.save();
    await notifyRaiser(g, `Grievance ${g.ticket} moved to ${tier.label}`, `It is now with the ${tier.desk}.`);
    return { ok: true };
}


async function sweep(now = new Date()) {
    const due = await Grievance.find({
        $or: [
            { status: { $in: ACTIVE }, tier: { $lt: 3 }, dueAt: { $lt: now } },
            { status: 'resolved', resolvedAt: { $lt: new Date(now.getTime() - LIMITS.reopenDays * DAY_MS) } }
        ]
    }).limit(500);
    for (const g of due) await refresh(g, now);
    return due.length;
}


async function adminQueue(filters = {}, now = new Date()) {
    await sweep(now);

    const query = {};
    if (STATUS[filters.status]) query.status = filters.status;
    else if (filters.status !== 'all') query.status = { $in: ACTIVE };
    if (TIERS[filters.tier]) query.tier = Number(filters.tier);
    if (CATEGORIES[filters.category]) query.category = filters.category;
    if (filters.overdue) {
        query.status = { $in: ACTIVE };
        query.dueAt = { $lt: now };
    }

    
    const openWork = Boolean(query.status && (query.status.$in || isActive(query.status)));
    const [items, byStatus, overdue] = await Promise.all([
        Grievance.find(query)
            .sort(openWork ? { dueAt: 1 } : { updatedAt: -1 })
            .limit(200)
            .populate('raisedBy', 'name email role')
            .lean(),
        Grievance.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
        Grievance.countDocuments({ status: { $in: ACTIVE }, dueAt: { $lt: now } })
    ]);

    const counts = { open: 0, in_review: 0, resolved: 0, closed: 0, overdue };
    byStatus.forEach(row => { if (row._id in counts) counts[row._id] = row.n; });
    counts.active = counts.open + counts.in_review;
    return { items: items.map(g => present(g, now)), counts };
}


async function adminSummary(now = new Date()) {
    const [active, overdue] = await Promise.all([
        Grievance.countDocuments({ status: { $in: ACTIVE } }),
        Grievance.countDocuments({ status: { $in: ACTIVE }, dueAt: { $lt: now } })
    ]);
    return { active, overdue };
}


function timeLeft(dueAt, now = new Date()) {
    if (!dueAt) return '';
    const diff = new Date(dueAt) - now;
    const abs = Math.abs(diff);
    const days = Math.floor(abs / DAY_MS);
    const hours = Math.floor((abs % DAY_MS) / HOUR_MS);
    const span = days ? `${days} day${days === 1 ? '' : 's'}${hours ? ` ${hours} h` : ''}` : `${Math.max(hours, 1)} h`;
    return diff >= 0 ? `due in ${span}` : `overdue by ${span}`;
}

const UPDATE_TEXT = {
    created: 'Grievance raised',
    reply: 'Reply from the raiser',
    response: 'Response from the grievance team',
    status: 'Status changed',
    escalated: 'Escalated',
    reopened: 'Reopened by the raiser'
};


function present(g, now = new Date()) {
    const plain = typeof g.toObject === 'function' ? g.toObject() : { ...g };
    const tier = TIERS[plain.tier] || TIERS[1];
    const status = STATUS[plain.status] || STATUS.open;
    return {
        ...plain,
        categoryLabel: CATEGORIES[plain.category] || CATEGORIES.other,
        statusLabel: status.label,
        statusBadge: status.badge,
        tierLabel: tier.label,
        tierDesk: tier.desk,
        tierSla: tier.sla,
        active: isActive(plain.status),
        overdue: isOverdue(plain, now),
        dueLabel: formatLocalizedDateTime(plain.dueAt),
        timeLeft: isActive(plain.status) ? timeLeft(plain.dueAt, now) : '',
        createdLabel: formatLocalizedDateTime(plain.createdAt),
        canReopen: canReopen(plain, now),
        updates: (plain.updates || []).map(u => ({
            ...u,
            title: u.kind === 'status' && STATUS[u.status] ? `Status changed to ${STATUS[u.status].label}` : UPDATE_TEXT[u.kind] || 'Update',
            atLabel: formatLocalizedDateTime(u.at)
        }))
    };
}

module.exports = {
    CATEGORIES,
    STATUS,
    TIERS,
    LIMITS,
    TICKET_PATTERN,
    addWorkingDays,
    dueDateFor,
    isActive,
    isOverdue,
    applyEscalations,
    applyAutoClose,
    canReopen,
    canView,
    raiserRoleFor,
    validateGrievanceInput,
    validateMessage,
    formatTicket,
    nextTicket,
    linkOptions,
    resolveLink,
    notifyRaiser,
    createGrievance,
    refresh,
    addRaiserReply,
    reopenGrievance,
    adminRespond,
    adminEscalate,
    sweep,
    adminQueue,
    adminSummary,
    timeLeft,
    present
};
