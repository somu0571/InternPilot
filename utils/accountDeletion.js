const User = require('../models/User');
const Application = require('../models/Application');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const Grievance = require('../models/Grievance');
const ResumeParse = require('../models/ResumeParse');
const Recommendation = require('../models/Recommendation');
const SavedSearch = require('../models/SavedSearch');
const SavedSearchAlertDelivery = require('../models/SavedSearchAlertDelivery');
const MockInterviewSession = require('../models/MockInterviewSession');
const ResumeProblemSet = require('../models/ResumeProblemSet');
const AccountSuspension = require('../models/AccountSuspension');
const { logAdminAction } = require('./adminAudit');
const { clearSuspensionCache, validateReason } = require('./suspensions');

// Company owners are left to employer verification: their listings and
// applicants depend on the account. Admins can't delete each other here.
const DELETABLE_ROLES = ['candidate', 'recruiter', 'hiring_manager'];

function deletionBlocker(admin, target) {
    if (!target) return 'User not found.';
    if (String(target._id) === String(admin._id)) return "You can't delete your own account.";
    if (target.role === 'admin') return "Admin accounts can't be deleted here.";
    if (target.role === 'company') return 'Company accounts are handled through employer verification, because their listings and applicants depend on them.';
    if (!DELETABLE_ROLES.includes(target.role)) return "This account can't be deleted.";
    return null;
}

/**
 * Everything that belongs to the account and goes with it. A candidate's
 * applications, chats, alerts and practice sessions only make sense with the
 * candidate. For company team members, the company's own records (listings,
 * chats, activity) stay with the company.
 */
function steps(target) {
    const id = target._id;
    const common = [
        { key: 'notifications', label: 'Notifications', model: Notification, filter: { recipient: id } },
        { key: 'grievances', label: 'Grievances they raised', model: Grievance, filter: { raisedBy: id } },
        { key: 'suspensions', label: 'Suspension records', model: AccountSuspension, filter: { user: id } }
    ];
    if (target.role !== 'candidate') return common;
    return [
        { key: 'applications', label: 'Applications', model: Application, filter: { candidate: id } },
        { key: 'conversations', label: 'Conversations with companies', model: Conversation, filter: { candidate: id } },
        ...common,
        { key: 'recommendations', label: 'Recommendations', model: Recommendation, filter: { candidate: id } },
        { key: 'savedSearches', label: 'Saved searches', model: SavedSearch, filter: { candidate: id } },
        { key: 'alertDeliveries', label: 'Search alert records', model: SavedSearchAlertDelivery, filter: { candidate: id } },
        { key: 'resumeParse', label: 'Resume parser record', model: ResumeParse, filter: { user: id } },
        { key: 'mockInterviews', label: 'Mock interview sessions', model: MockInterviewSession, filter: { candidate: id } },
        { key: 'problemSets', label: 'Practice problem sets', model: ResumeProblemSet, filter: { candidate: id } }
    ];
}

/** What deleting would remove, for the confirmation panel. */
async function deletionPreview(target) {
    const plan = steps(target);
    const counts = await Promise.all(plan.map(s => s.model.countDocuments(s.filter)));
    return plan.map((s, i) => ({ key: s.key, label: s.label, count: counts[i] })).filter(s => s.count > 0);
}

/**
 * Permanently deletes an account and what belongs to it. The admin has to
 * type the account's email and give a reason. The account itself goes last,
 * so if anything fails part way the admin can simply try again.
 */
async function deleteAccount(admin, target, { confirmEmail, reason: text } = {}) {
    const blocker = deletionBlocker(admin, target);
    if (blocker) return { error: blocker };
    const typed = String(confirmEmail || '').trim().toLowerCase();
    if (!typed || typed !== String(target.email || '').trim().toLowerCase()) {
        return { error: "Type the account's email address exactly to confirm." };
    }
    const { reason, error } = validateReason(text);
    if (error) return { error: error.replace('The user will see it.', 'It is kept in the audit log.') };

    const removed = {};
    if (target.role === 'candidate') {
        const conversations = await Conversation.find({ candidate: target._id }).select('_id').lean();
        removed.messages = (await Message.deleteMany({ conversation: { $in: conversations.map(c => c._id) } })).deletedCount;
    }
    for (const step of steps(target)) {
        removed[step.key] = (await step.model.deleteMany(step.filter)).deletedCount;
    }
    removed.account = (await User.deleteOne({ _id: target._id })).deletedCount;
    clearSuspensionCache(target._id);

    await logAdminAction(admin, {
        action: 'user.delete',
        targetType: 'user',
        targetId: target._id,
        targetLabel: `${target.name || 'User'} <${target.email || ''}>`,
        reason,
        details: removed
    });
    return { ok: true, removed };
}

module.exports = {
    DELETABLE_ROLES,
    deletionBlocker,
    steps,
    deletionPreview,
    deleteAccount
};
