const Announcement = require('../models/Announcement');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { COMPANY_ROLES } = require('../middleware/companyAccess');
const { formatLocalizedDateTime } = require('./dateFormat');
const { logAdminAction, registerNotificationTypes } = require('./adminAudit');

registerNotificationTypes('announcement');

const AUDIENCES = { everyone: 'Everyone', candidates: 'Candidates', companies: 'Companies' };
const TONES = {
    info: { label: 'Info', banner: 'bg-indigo-50 border-indigo-200 text-indigo-900', icon: 'ph-info' },
    warning: { label: 'Warning', banner: 'bg-amber-50 border-amber-200 text-amber-900', icon: 'ph-warning' },
    success: { label: 'Good news', banner: 'bg-emerald-50 border-emerald-200 text-emerald-900', icon: 'ph-check-circle' }
};
const LIMITS = { title: 120, message: 500, maxDays: 90 };
const NOTIFY_CAP = 5000;
const CACHE_MS = 60 * 1000;
const IST = '+05:30';

// Every page render asks for the live banners, so the list is kept for a minute.
let cache = { at: 0, items: [] };
const clearAnnouncementCache = () => { cache = { at: 0, items: [] }; };

function isLive(a, now = new Date()) {
    return Boolean(a && !a.endedAt && new Date(a.startsAt) <= now && (!a.endsAt || new Date(a.endsAt) > now));
}

function audienceMatches(audience, user) {
    if (audience === 'everyone') return true;
    if (!user) return false;
    if (audience === 'candidates') return user.role === 'candidate';
    if (audience === 'companies') return COMPANY_ROLES.includes(user.role);
    return false;
}

const visibleTo = (items, user, now = new Date()) => items.filter(a => isLive(a, now) && audienceMatches(a.audience, user));

async function liveAnnouncements(now = Date.now()) {
    if (now - cache.at < CACHE_MS) return cache.items;
    // Also fetch anything starting within the cache window so it shows on time.
    const items = await Announcement.find({
        endedAt: null,
        startsAt: { $lte: new Date(now + CACHE_MS) },
        $or: [{ endsAt: null }, { endsAt: { $gt: new Date(now) } }]
    }).sort({ startsAt: -1 }).limit(5).lean();
    cache = { at: now, items };
    return items;
}

/** datetime-local inputs have no zone; the portal runs on India time. */
function parseLocalDateTime(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return undefined;
    const date = new Date(`${text}:00${IST}`);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

function validateAnnouncement(body = {}, now = new Date()) {
    const title = String(body.title || '').trim();
    const message = String(body.message || '').trim();
    const audience = AUDIENCES[body.audience] ? body.audience : '';
    const tone = TONES[body.tone] ? body.tone : '';
    const startsInput = parseLocalDateTime(body.startsAt);
    const endsInput = parseLocalDateTime(body.endsAt);
    const errors = [];

    if (title.length < 5 || title.length > LIMITS.title) errors.push(`The title needs 5 to ${LIMITS.title} characters.`);
    if (message.length < 10 || message.length > LIMITS.message) errors.push(`The message needs 10 to ${LIMITS.message} characters.`);
    if (!audience) errors.push('Choose who should see it.');
    if (!tone) errors.push('Choose a tone.');
    if (startsInput === undefined || endsInput === undefined) errors.push('Use a valid date and time.');

    const startsAt = startsInput || now;
    const endsAt = endsInput || null;
    if (endsAt && endsAt <= startsAt) errors.push('The end has to be after the start.');
    if (endsAt && endsAt - startsAt > LIMITS.maxDays * 24 * 60 * 60 * 1000) errors.push(`Announcements can run for at most ${LIMITS.maxDays} days.`);

    return {
        value: { title, message, audience, tone, startsAt, endsAt, notify: body.notify === '1' },
        errors
    };
}

/**
 * In-app notifications for the announcement's audience. Candidates get their
 * own; companies get one per company, which their whole team sees. Capped so
 * one click can't flood the database.
 */
async function notifyAudience(announcement) {
    const base = { type: 'announcement', title: announcement.title, message: announcement.message, link: '/' };
    const docs = [];
    if (announcement.audience !== 'companies') {
        const candidates = await User.find({ role: 'candidate' }).select('_id').limit(NOTIFY_CAP).lean();
        candidates.forEach(c => docs.push({ ...base, recipient: c._id }));
    }
    if (announcement.audience !== 'candidates') {
        const companies = await User.find({ role: 'company' }).select('_id').limit(NOTIFY_CAP).lean();
        companies.forEach(c => docs.push({ ...base, companyId: c._id }));
    }
    for (let i = 0; i < docs.length; i += 1000) {
        await Notification.insertMany(docs.slice(i, i + 1000), { ordered: false });
    }
    return docs.length;
}

async function createAnnouncement(admin, body, now = new Date()) {
    const { value, errors } = validateAnnouncement(body, now);
    if (errors.length) return { errors, value };

    const { notify, ...fields } = value;
    const announcement = await Announcement.create({ ...fields, createdBy: admin._id });
    // Notifications only go out for announcements that start now.
    if (notify && fields.startsAt <= now) {
        announcement.notified = await notifyAudience(announcement);
        await announcement.save();
    }
    clearAnnouncementCache();
    await logAdminAction(admin, {
        action: 'announcement.create',
        targetType: 'announcement',
        targetId: announcement._id,
        targetLabel: announcement.title,
        details: { audience: fields.audience, tone: fields.tone, notified: announcement.notified }
    });
    return { announcement };
}

async function endAnnouncement(admin, id, now = new Date()) {
    const announcement = await Announcement.findOneAndUpdate(
        { _id: id, endedAt: null },
        { $set: { endedAt: now } },
        { returnDocument: 'after' }
    );
    if (!announcement) return { error: 'That announcement was not found or has already ended.' };
    clearAnnouncementCache();
    await logAdminAction(admin, { action: 'announcement.end', targetType: 'announcement', targetId: announcement._id, targetLabel: announcement.title });
    return { ok: true };
}

function stateOf(a, now = new Date()) {
    if (a.endedAt) return { key: 'ended', label: 'Ended' };
    if (new Date(a.startsAt) > now) return { key: 'scheduled', label: 'Scheduled' };
    if (a.endsAt && new Date(a.endsAt) <= now) return { key: 'expired', label: 'Expired' };
    return { key: 'live', label: 'Live' };
}

async function listAnnouncements(now = new Date()) {
    const items = await Announcement.find().sort({ createdAt: -1 }).limit(100).populate('createdBy', 'name').lean();
    return items.map(a => ({
        ...a,
        state: stateOf(a, now),
        audienceLabel: AUDIENCES[a.audience] || a.audience,
        toneLabel: (TONES[a.tone] || TONES.info).label,
        startsLabel: formatLocalizedDateTime(a.startsAt),
        endsLabel: a.endsAt ? formatLocalizedDateTime(a.endsAt) : ''
    }));
}

const wantsJson = req => req.xhr || req.get('X-Requested-With') === 'fetch' || req.accepts(['html', 'json']) === 'json';

/** Puts the banners for this visitor on res.locals.siteAnnouncements. */
function loadAnnouncements(req, res, next) {
    if (req.method !== 'GET' || wantsJson(req)) return next();
    liveAnnouncements().then(items => {
        res.locals.siteAnnouncements = visibleTo(items, req.user).map(a => ({
            id: String(a._id),
            title: a.title,
            message: a.message,
            tone: TONES[a.tone] || TONES.info
        }));
        next();
    }).catch(err => {
        console.error('Could not load announcements:', err);
        next();
    });
}

module.exports = {
    AUDIENCES,
    TONES,
    LIMITS,
    NOTIFY_CAP,
    isLive,
    audienceMatches,
    visibleTo,
    liveAnnouncements,
    clearAnnouncementCache,
    parseLocalDateTime,
    validateAnnouncement,
    notifyAudience,
    createAnnouncement,
    endAnnouncement,
    stateOf,
    listAnnouncements,
    loadAnnouncements
};
