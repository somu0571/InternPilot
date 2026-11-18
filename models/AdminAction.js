const mongoose = require('mongoose');


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
    
    
    targetLabel: { type: String, default: '', trim: true, maxlength: 200 },
    reason: { type: String, default: '', trim: true, maxlength: 1000 },
    details: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: { createdAt: true, updatedAt: false } });

adminActionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AdminAction', adminActionSchema);
module.exports.ACTIONS = ACTIONS;
