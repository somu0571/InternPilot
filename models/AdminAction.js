const mongoose = require('mongoose');

// Audit log for the admin console: who did what, to whom, when and why.
const ACTIONS = [
    'user.suspend',
    'user.reactivate',
    'user.delete',
    'listing.pause',
    'listing.close',
    'listing.restore',
    'announcement.create',
    'announcement.end',
    'export.overview',
    'export.applications'
];

const adminActionSchema = new mongoose.Schema({
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    action: { type: String, enum: ACTIONS, required: true, index: true },
    targetType: { type: String, enum: ['user', 'internship', 'announcement', 'report'], required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, index: true },
    // A readable name kept at the time of the action, so the log still makes
    // sense if the target is later renamed or removed.
    targetLabel: { type: String, default: '', trim: true, maxlength: 200 },
    reason: { type: String, default: '', trim: true, maxlength: 1000 },
    details: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: { createdAt: true, updatedAt: false } });

adminActionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AdminAction', adminActionSchema);
module.exports.ACTIONS = ACTIONS;
