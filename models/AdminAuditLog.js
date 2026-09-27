const mongoose = require('mongoose');

const adminAuditLogSchema = new mongoose.Schema({
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    action: {
        type: String,
        enum: [
            'USER_SUSPENDED', 'USER_REACTIVATED',
            'LISTING_PAUSED', 'LISTING_CLOSED', 'LISTING_RESTORED',
            'ANNOUNCEMENT_CREATED', 'ANNOUNCEMENT_UPDATED', 'ANNOUNCEMENT_DELETED'
        ],
        required: true,
        index: true
    },
    targetType: { type: String, enum: ['User', 'Internship', 'Announcement'], required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    reason: { type: String, default: '', trim: true, maxlength: 1000 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now, index: true }
}, { versionKey: false });

adminAuditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AdminAuditLog', adminAuditLogSchema);
