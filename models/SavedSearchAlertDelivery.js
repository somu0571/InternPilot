const mongoose = require('mongoose');





const savedSearchAlertDeliverySchema = new mongoose.Schema({
    candidate: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    internship: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Internship',
        required: true,
        index: true
    },
    channel: {
        type: String,
        enum: ['instant_email'],
        required: true
    },
    status: {
        type: String,
        enum: ['sending', 'sent'],
        default: 'sending',
        required: true
    },
    
    claimToken: { type: String, required: true },
    leaseExpiresAt: { type: Date },
    sentAt: { type: Date }
}, { timestamps: true });

savedSearchAlertDeliverySchema.index(
    { candidate: 1, internship: 1, channel: 1 },
    { unique: true }
);
savedSearchAlertDeliverySchema.index({ status: 1, leaseExpiresAt: 1 });

module.exports = mongoose.model('SavedSearchAlertDelivery', savedSearchAlertDeliverySchema);
