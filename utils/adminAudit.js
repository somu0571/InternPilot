const AdminAction = require('../models/AdminAction');
const Notification = require('../models/Notification');

const ACTION_LABELS = {
    'user.suspend': 'Suspended sign-in',
    'user.reactivate': 'Reactivated sign-in',
    'user.delete': 'Deleted an account',
    'listing.pause': 'Paused a listing',
    'listing.close': 'Closed a listing',
    'listing.restore': 'Restored a listing',
    'announcement.create': 'Posted an announcement',
    'announcement.end': 'Ended an announcement',
    'export.overview': 'Downloaded the overview CSV',
    'export.applications': 'Downloaded the applications CSV'
};

const PAGE_SIZE = 50;

/**
 * Adds the notification types the console sends, without editing
 * models/Notification.js (same approach as messaging and grievances).
 */
function registerNotificationTypes(...types) {
    const typePath = Notification.schema.path('type');
    if (!typePath || !Array.isArray(typePath.enumValues)) return;
    types.filter(t => !typePath.enumValues.includes(t)).forEach(t => typePath.enum(t));
}

/**
 * Records one admin action. Never throws: a logging problem must not undo
 * or block the action itself.
 */
async function logAdminAction(admin, { action, targetType, targetId, targetLabel, reason, details } = {}) {
    try {
        return await AdminAction.create({
            admin: admin._id,
            action,
            targetType,
            targetId,
            targetLabel: String(targetLabel || '').slice(0, 200),
            reason: String(reason || '').slice(0, 1000),
            details
        });
    } catch (err) {
        console.error('Could not write the admin audit log:', err);
        return null;
    }
}

const pageNumber = value => Math.max(1, Math.min(1000, parseInt(value, 10) || 1));

/** Newest first, optionally one action type or one target. */
async function listActions({ action, targetId, page } = {}) {
    const query = {};
    if (ACTION_LABELS[action]) query.action = action;
    if (targetId) query.targetId = targetId;
    const current = pageNumber(page);
    const [items, total] = await Promise.all([
        AdminAction.find(query)
            .sort({ createdAt: -1 })
            .skip((current - 1) * PAGE_SIZE)
            .limit(PAGE_SIZE)
            .populate('admin', 'name email')
            .lean(),
        AdminAction.countDocuments(query)
    ]);
    return {
        items: items.map(a => ({ ...a, label: ACTION_LABELS[a.action] || a.action })),
        page: current,
        pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
        total
    };
}

module.exports = {
    ACTION_LABELS,
    PAGE_SIZE,
    registerNotificationTypes,
    logAdminAction,
    listActions,
    pageNumber
};
