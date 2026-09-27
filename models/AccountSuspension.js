const mongoose = require('mongoose');

const accountSuspensionSchema = new mongoose.Schema({
    subject: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    suspendedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    isActive: { type: Boolean, default: true, index: true },
    suspendedAt: { type: Date, default: Date.now },
    reactivatedAt: { type: Date },
    reactivatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

accountSuspensionSchema.index({ subject: 1, isActive: 1 });

module.exports = mongoose.model('AccountSuspension', accountSuspensionSchema);
