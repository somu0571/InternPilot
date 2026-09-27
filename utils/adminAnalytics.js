const mongoose = require('mongoose');
const User = require('../models/User');
const Internship = require('../models/Internship');
const Application = require('../models/Application');
const { checkPmisEligibility } = require('./pmisEligibility');

const RANGES = { 7: 'Last 7 days', 30: 'Last 30 days', 90: 'Last 90 days' };
const PIPELINE = ['Submitted', 'Under Review', 'Shortlisted', 'Interview', 'Hired'];
const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 330 * 60 * 1000;
const TIMEZONE = 'Asia/Kolkata';
const FUNNEL_SCAN = 50000;
const ELIGIBILITY_SCAN = 5000;

const parseRange = value => (RANGES[value] ? Number(value) : 30);

/** "2026-09-27" for the India-time calendar day of `date`. */
const istDayKey = date => new Date(new Date(date).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

function startOfIstDay(date) {
    const shifted = new Date(new Date(date).getTime() + IST_OFFSET_MS);
    shifted.setUTCHours(0, 0, 0, 0);
    return new Date(shifted.getTime() - IST_OFFSET_MS);
}

/**
 * The selected range covers today and the days before it, in India time.
 * The previous period is the same number of days just before it.
 */
function periodBounds(days, now = new Date()) {
    const start = new Date(startOfIstDay(now).getTime() - (days - 1) * DAY_MS);
    return { start, end: now, prevStart: new Date(start.getTime() - days * DAY_MS), prevEnd: start };
}

/** Whole-number % change, or null when there was nothing before to compare with. */
function percentChange(current, previous) {
    if (!previous) return current ? null : 0;
    return Math.round(((current - previous) / previous) * 100);
}

function istDays(start, end) {
    const keys = [];
    for (let t = startOfIstDay(start).getTime(); t < end.getTime(); t += DAY_MS) keys.push(istDayKey(t));
    return [...new Set(keys)];
}

/** An ObjectId for a moment in time, for date ranges on models without createdAt. */
const oidAt = date => mongoose.Types.ObjectId.createFromTime(Math.floor(new Date(date).getTime() / 1000));

const normalizeStatus = status => (status === 'pending' ? 'Submitted' : status);

/**
 * Funnel from each application's status history, so a candidate rejected
 * after the interview still counts as having reached the interview.
 *
 * @param {Array<{status: string, history?: string[]}>} apps
 */
function buildFunnel(apps = []) {
    const reached = PIPELINE.map(() => 0);
    const exits = { Rejected: 0, Withdrawn: 0 };
    apps.forEach(app => {
        const statuses = [app.status, ...(app.history || [])].map(normalizeStatus);
        const furthest = Math.max(0, ...statuses.map(s => PIPELINE.indexOf(s)));
        for (let i = 0; i <= furthest; i += 1) reached[i] += 1;
        if (exits[normalizeStatus(app.status)] !== undefined) exits[normalizeStatus(app.status)] += 1;
    });
    const steps = PIPELINE.map((status, i) => ({
        status,
        reached: reached[i],
        conversion: i === 0 ? null : (reached[i - 1] ? Math.round((reached[i] / reached[i - 1]) * 100) : 0)
    }));
    return { steps, exits, total: apps.length };
}

/** A spreadsheet-safe CSV cell: quoted when needed, formulas neutralised. */
function csvCell(value) {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** @param {Array<{label: string, value: Function|string}>} columns */
function toCsv(columns, rows) {
    const read = (row, col) => (typeof col.value === 'function' ? col.value(row) : row[col.value]);
    const lines = [columns.map(c => csvCell(c.label)).join(',')];
    rows.forEach(row => lines.push(columns.map(c => csvCell(read(row, c))).join(',')));
    return `${lines.join('\r\n')}\r\n`;
}

async function kpis(days, now = new Date()) {
    const { start, end, prevStart, prevEnd } = periodBounds(days, now);
    const between = (a, b) => ({ $gte: a, $lt: b });
    const pair = (Model, build) => Promise.all([Model.countDocuments(build(start, end)), Model.countDocuments(build(prevStart, prevEnd))]);

    const [candidates, companies, listings, applications, hires, pendingCompanies, liveListings, allCandidates] = await Promise.all([
        pair(User, (a, b) => ({ role: 'candidate', createdAt: between(a, b) })),
        pair(User, (a, b) => ({ role: 'company', createdAt: between(a, b) })),
        pair(Internship, (a, b) => ({ _id: { $gte: oidAt(a), $lt: oidAt(b) } })),
        pair(Application, (a, b) => ({ createdAt: between(a, b) })),
        pair(Application, (a, b) => ({ status: 'Hired', statusUpdatedAt: between(a, b) })),
        User.countDocuments({ role: 'company', $or: [{ 'companyDetails.isVerified': false }, { 'companyDetails.isVerified': { $exists: false } }] }),
        Internship.countDocuments({ status: 'published' }),
        User.countDocuments({ role: 'candidate' })
    ]);

    const card = (key, label, [value, previous]) => ({ key, label, value, previous, change: percentChange(value, previous) });
    return {
        cards: [
            card('candidates', 'New candidates', candidates),
            card('companies', 'New companies', companies),
            card('listings', 'New listings', listings),
            card('applications', 'Applications', applications),
            card('hires', 'Hires', hires)
        ],
        totals: { pendingCompanies, liveListings, allCandidates }
    };
}

async function dailySeries(days, now = new Date()) {
    const { start, end } = periodBounds(days, now);
    const byDay = field => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: TIMEZONE } });
    const [signups, applications] = await Promise.all([
        User.aggregate([{ $match: { role: 'candidate', createdAt: { $gte: start, $lt: end } } }, { $group: { _id: byDay('$createdAt'), n: { $sum: 1 } } }]),
        Application.aggregate([{ $match: { createdAt: { $gte: start, $lt: end } } }, { $group: { _id: byDay('$createdAt'), n: { $sum: 1 } } }])
    ]);
    const toMap = rows => new Map(rows.map(r => [r._id, r.n]));
    const signupMap = toMap(signups);
    const applicationMap = toMap(applications);
    const labels = istDays(start, end);
    return {
        labels,
        signups: labels.map(d => signupMap.get(d) || 0),
        applications: labels.map(d => applicationMap.get(d) || 0)
    };
}

async function funnel(days, now = new Date()) {
    const { start, end } = periodBounds(days, now);
    const apps = await Application.aggregate([
        { $match: { createdAt: { $gte: start, $lt: end } } },
        { $limit: FUNNEL_SCAN },
        { $project: { _id: 0, status: 1, history: '$statusHistory.status' } }
    ]);
    return buildFunnel(apps);
}

const lookupOne = (from, localField, project) => ({
    $lookup: {
        from,
        let: { id: `$${localField}` },
        pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$id'] } } }, { $project: project }],
        as: 'joined'
    }
});

async function byState(days, now = new Date()) {
    const { start, end } = periodBounds(days, now);
    const rows = await Application.aggregate([
        { $match: { createdAt: { $gte: start, $lt: end } } },
        lookupOne(User.collection.name, 'candidate', { state: '$location.state' }),
        { $group: { _id: { $ifNull: [{ $arrayElemAt: ['$joined.state', 0] }, ''] }, applications: { $sum: 1 } } },
        { $sort: { applications: -1 } },
        { $limit: 10 }
    ]);
    return rows.map(r => ({ state: String(r._id || '').trim() || 'Not set', applications: r.applications }));
}

async function topListings(days, now = new Date()) {
    const { start, end } = periodBounds(days, now);
    const rows = await Application.aggregate([
        { $match: { createdAt: { $gte: start, $lt: end } } },
        { $group: { _id: '$internship', applications: { $sum: 1 }, hired: { $sum: { $cond: [{ $eq: ['$status', 'Hired'] }, 1, 0] } } } },
        { $sort: { applications: -1 } },
        { $limit: 10 },
        lookupOne(Internship.collection.name, '_id', { title: 1, companyName: 1, vacancies: 1, status: 1 })
    ]);
    return rows.map(r => {
        const listing = r.joined[0] || {};
        return {
            id: String(r._id),
            title: listing.title || 'Removed listing',
            company: listing.companyName || '',
            status: listing.status || '',
            openings: Number(listing.vacancies) || 0,
            applications: r.applications,
            hired: r.hired
        };
    });
}

async function skillsGap() {
    const clean = { $toLower: { $trim: { input: '$skill' } } };
    const [demand, supply] = await Promise.all([
        Internship.aggregate([
            { $match: { status: 'published' } },
            { $project: { skill: '$requiredSkills' } },
            { $unwind: '$skill' },
            { $group: { _id: clean, listings: { $sum: 1 }, label: { $first: '$skill' } } },
            { $match: { _id: { $ne: '' } } },
            { $sort: { listings: -1 } },
            { $limit: 12 }
        ]),
        User.aggregate([
            { $match: { role: 'candidate' } },
            { $project: { skill: '$skills' } },
            { $unwind: '$skill' },
            { $group: { _id: clean, candidates: { $sum: 1 } } }
        ])
    ]);
    const supplyMap = new Map(supply.map(s => [s._id, s.candidates]));
    return demand.map(d => {
        const candidates = supplyMap.get(d._id) || 0;
        return {
            skill: String(d.label || d._id).trim(),
            listings: d.listings,
            candidates,
            // Candidates per listing asking for it: below 1 means demand is ahead of supply.
            perListing: d.listings ? Math.round((candidates / d.listings) * 10) / 10 : 0
        };
    });
}

async function eligibility() {
    const candidates = await User.find({ role: 'candidate' })
        .select('age familyIncome education qualification enrollmentStatus employmentStatus')
        .limit(ELIGIBILITY_SCAN)
        .lean();
    const counts = { eligible: 0, ineligible: 0, incomplete: 0 };
    candidates.forEach(c => {
        const { status } = checkPmisEligibility(c);
        counts[counts[status] !== undefined ? status : 'incomplete'] += 1;
    });
    return { ...counts, scanned: candidates.length, capped: candidates.length >= ELIGIBILITY_SCAN };
}

async function overview(days, now = new Date()) {
    const range = parseRange(days);
    const [summary, series, funnelData, states, listings, skills, pmis] = await Promise.all([
        kpis(range, now),
        dailySeries(range, now),
        funnel(range, now),
        byState(range, now),
        topListings(range, now),
        skillsGap(),
        eligibility()
    ]);
    return { range, rangeLabel: RANGES[range], summary, series, funnel: funnelData, states, listings, skills, pmis };
}

/** One CSV with every overview table, marked by section. */
function overviewCsv(data) {
    const rows = [];
    data.summary.cards.forEach(c => rows.push({ section: 'Summary', item: c.label, value: c.value, extra: `previous period: ${c.previous}` }));
    data.funnel.steps.forEach(s => rows.push({ section: 'Funnel', item: s.status, value: s.reached, extra: s.conversion === null ? '' : `${s.conversion}% from previous step` }));
    Object.entries(data.funnel.exits).forEach(([k, v]) => rows.push({ section: 'Funnel', item: k, value: v, extra: '' }));
    data.states.forEach(s => rows.push({ section: 'Applications by state', item: s.state, value: s.applications, extra: '' }));
    data.listings.forEach(l => rows.push({ section: 'Top listings', item: `${l.title} (${l.company})`, value: l.applications, extra: `hired ${l.hired} of ${l.openings} openings` }));
    data.skills.forEach(s => rows.push({ section: 'Skills gap', item: s.skill, value: s.listings, extra: `${s.candidates} candidates list it` }));
    ['eligible', 'ineligible', 'incomplete'].forEach(k => rows.push({ section: 'PMIS eligibility', item: k, value: data.pmis[k], extra: '' }));
    return toCsv([
        { label: 'Section', value: 'section' },
        { label: 'Item', value: 'item' },
        { label: 'Value', value: 'value' },
        { label: 'Notes', value: 'extra' }
    ], rows);
}

module.exports = {
    RANGES,
    PIPELINE,
    parseRange,
    istDayKey,
    startOfIstDay,
    periodBounds,
    percentChange,
    istDays,
    oidAt,
    buildFunnel,
    csvCell,
    toCsv,
    kpis,
    dailySeries,
    funnel,
    byState,
    topListings,
    skillsGap,
    eligibility,
    overview,
    overviewCsv
};
