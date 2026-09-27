const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: function() { return !this.companyId; },
        index: true
    },
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: function() { return !this.recipient; },
        index: true
    },
    type: {
        type: String,
        enum: [
            'application_status', 
            'application_shortlisted', 
            'new_matching_internship',
            'saved_search_digest',
            'new_application',
            'candidate_withdrawal',
            'approaching_deadline',
            'high_application_volume',
            'upcoming_interview',
            'interview_scheduled', 
            'interview_rescheduled', 
            'interview_cancelled',
            'certificate_issued',
            'offer_issued',
            'offer_accepted',
            'offer_declined',
            'offer_expired'
        ],
        required: true
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    link: { type: String, default: '/notifications' },
    internship: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Internship'
    },
    application: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Application'
    },
    metadata: {
        threshold: { type: Number },
        interviewId: { type: String },
        savedSearchId: { type: mongoose.Schema.Types.ObjectId, ref: 'SavedSearch' },
        digestKey: { type: String },
        internshipCount: { type: Number },
        searchNames: [{ type: String }],
        offerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer' }
    },
    isRead: { type: Boolean, default: false, index: true }
}, { timestamps: true });

// Read state indices
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ companyId: 1, isRead: 1, createdAt: -1 });

// Idempotency indices
notificationSchema.index(
    { recipient: 1, internship: 1, type: 1 },
    {
        unique: true,
        partialFilterExpression: { type: 'new_matching_internship' }
    }
);

notificationSchema.index(
    { recipient: 1, type: 1, 'metadata.digestKey': 1 },
    {
        unique: true,
        partialFilterExpression: { type: 'saved_search_digest' }
    }
);

notificationSchema.index(
    { companyId: 1, internship: 1, type: 1 },
    {
        unique: true,
        partialFilterExpression: { type: 'approaching_deadline' }
    }
);

notificationSchema.index(
    { companyId: 1, internship: 1, type: 1, 'metadata.threshold': 1 },
    {
        unique: true,
        partialFilterExpression: { type: 'high_application_volume' }
    }
);

notificationSchema.index(
    { companyId: 1, application: 1, type: 1, 'metadata.interviewId': 1 },
    {
        unique: true,
        partialFilterExpression: { type: 'upcoming_interview' }
    }
);

module.exports = mongoose.model('Notification', notificationSchema);
