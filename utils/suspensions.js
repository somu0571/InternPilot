const AccountSuspension = require('../models/AccountSuspension');
const Notification = require('../models/Notification');
const { logAdminAction, registerNotificationTypes } = require('./adminAudit');

registerNotificationTypes('account_update');

// Company owner accounts are managed through employer verification (#162),
// and admins can't lock each other out from here.
const SUSPENDABLE_ROLES = ['candidate', 'recruiter', 'hiring_manager'];
const CACHE_MS = 30 * 1000;
const CACHE_LIMIT = 5000;

// userId -> { suspension, at }. Every signed-in request asks, so answers are
// kept briefly; suspending or reactivating clears the entry straight away.
const cache = new Map();

function clearSuspensionCache(userId) {
    if (userId) cache.delete(String(userId));
    else cache.clear();
}

async function activeSuspension(userId, now = Date.now()) {
    const key = String(userId);
    const hit = cache.get(key);
    if (hit && now - hit.at < CACHE_MS) return hit.suspension;
    const suspension = await AccountSuspension.findOne({ user: userId, active: true }).select('reason createdAt').lean();
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(key, { suspension, at: now });
    return suspension;
}

/** @returns {string|null} Why this admin can't suspend this account, if they can't. */
function suspensionBlocker(admin, target) {
    if (!target) return 'User not found.';
    if (String(target._id) === String(admin._id)) return "You can't suspend your own account.";
    if (target.role === 'admin') return "Admin accounts can't be suspended here.";
    if (target.role === 'company') return 'Company accounts are managed through employer verification.';
    if (!SUSPENDABLE_ROLES.includes(target.role)) return "This account can't be suspended.";
    return null;
}

function validateReason(text, min = 10) {
    const reason = String(text || '').trim();
    if (reason.length < min) return { error: `Give a reason of at least ${min} characters. The user will see it.` };
    if (reason.length > 1000) return { error: 'Keep the reason under 1000 characters.' };
    return { reason };
}

const labelOf = user => `${user.name || 'User'} <${user.email || ''}>`;

async function suspendUser(admin, target, text) {
    const blocker = suspensionBlocker(admin, target);
    if (blocker) return { error: blocker };
    const { reason, error } = validateReason(text);
    if (error) return { error };

    try {
        await AccountSuspension.create({ user: target._id, reason, suspendedBy: admin._id });
    } catch (err) {
        if (err && err.code === 11000) return { error: 'This account is already suspended.' };
        throw err;
    }
    clearSuspensionCache(target._id);
    await logAdminAction(admin, { action: 'user.suspend', targetType: 'user', targetId: target._id, targetLabel: labelOf(target), reason });
    return { ok: true };
}

async function reactivateUser(admin, target, text) {
    if (!target) return { error: 'User not found.' };
    const note = String(text || '').trim().slice(0, 1000);
    const lifted = await AccountSuspension.findOneAndUpdate(
        { user: target._id, active: true },
        { $set: { active: false, liftedBy: admin._id, liftedAt: new Date(), liftReason: note } },
        { returnDocument: 'after' }
    );
    if (!lifted) return { error: 'This account is not suspended.' };
    clearSuspensionCache(target._id);
    await logAdminAction(admin, { action: 'user.reactivate', targetType: 'user', targetId: target._id, targetLabel: labelOf(target), reason: note });
    try {
        await Notification.create({
            recipient: target._id,
            type: 'account_update',
            title: 'Your account is active again',
            message: 'An admin reactivated your account. You can use InternPilot as before.',
            link: '/'
        });
    } catch (err) {
        console.error('Could not send the reactivation notice:', err);
    }
    return { ok: true };
}

const wantsJson = req => req.xhr || req.get('X-Requested-With') === 'fetch' || req.accepts(['html', 'json']) === 'json';

/** The sign-in page message, with the reason the admin gave. */
function suspendedMessage(reason) {
    const why = String(reason || '').trim().replace(/[.\s]+$/, '');
    return `Your account has been suspended${why ? `. Reason: ${why}` : ''}. If you think this is a mistake, contact the InternPilot team.`;
}

/**
 * Signs a suspended user out on their next request and sends them to the
 * sign-in page with the reason. Admins are never checked. If the lookup
 * itself fails the request goes through, so a database hiccup can't lock
 * everyone out.
 */
function enforceSuspension(req, res, next) {
    if (!req.user || req.user.role === 'admin') return next();
    activeSuspension(req.user._id).then(suspension => {
        if (!suspension) return next();
        const finish = () => {
            if (req.flash) req.flash('error_msg', suspendedMessage(suspension.reason));
            if (wantsJson(req)) return res.status(403).json({ error: 'Your account has been suspended.' });
            return res.redirect('/auth/login');
        };
        if (typeof req.logout !== 'function') return finish();
        return req.logout(err => (err ? next(err) : finish()));
    }).catch(err => {
        console.error('Suspension check failed:', err);
        next();
    });
}

async function suspensionHistory(userId) {
    return AccountSuspension.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(20)
        .populate('suspendedBy', 'name')
        .populate('liftedBy', 'name')
        .lean();
}

/** Ids of the given users who are suspended right now. */
async function suspendedAmong(userIds) {
    if (!userIds.length) return new Set();
    const rows = await AccountSuspension.find({ user: { $in: userIds }, active: true }).select('user').lean();
    return new Set(rows.map(r => String(r.user)));
}

module.exports = {
    SUSPENDABLE_ROLES,
    CACHE_MS,
    activeSuspension,
    clearSuspensionCache,
    suspensionBlocker,
    validateReason,
    suspendUser,
    reactivateUser,
    suspendedMessage,
    enforceSuspension,
    suspensionHistory,
    suspendedAmong
};
