const mongoose = require('mongoose');

const OFFER_STATUSES = ['issued', 'accepting', 'accepted', 'declined', 'expired', 'revoked'];
const OFFER_ACTIONS = ['issued', 'accepted', 'declined', 'expired', 'revoked'];

const offerSchema = new mongoose.Schema({
    application: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Application',
        required: true,
        index: true
    },
    internship: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Internship',
        required: true,
        index: true
    },
    candidate: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    company: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    issuedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    status: {
        type: String,
        enum: OFFER_STATUSES,
        default: 'issued',
        index: true
    },
    // This is kept separate from status so the partial unique index can
    // prevent two actionable offers for one application, while still allowing
    // a company to make a new offer after an earlier one expires or is declined.
    isActive: { type: Boolean, default: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
    terms: {
        startDate: { type: Date },
        monthlyStipend: { type: Number, min: 0 },
        duration: { type: String, trim: true, maxlength: 120, default: '' },
        additionalTerms: { type: String, trim: true, maxlength: 2000, default: '' }
    },
    acceptanceStartedAt: { type: Date },
    acceptedAt: { type: Date },
    declinedAt: { type: Date },
    expiredAt: { type: Date },
    revokedAt: { type: Date },
    declineReason: { type: String, trim: true, maxlength: 500, default: '' },
    // A seat is reserved only once the candidate accepts. It exists so a
    // failure-recovery path can safely return a reserved seat exactly once.
    seatReserved: { type: Boolean, default: false },
    seatReservedAt: { type: Date },
    events: [{
        action: { type: String, enum: OFFER_ACTIONS, required: true },
        actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        actorRole: { type: String, enum: ['company', 'candidate', 'system'], required: true },
        at: { type: Date, default: Date.now },
        reason: { type: String, trim: true, maxlength: 500, default: '' }
    }]
}, { timestamps: true });

offerSchema.index(
    { application: 1, isActive: 1 },
    { unique: true, partialFilterExpression: { isActive: true } }
);
offerSchema.index({ candidate: 1, status: 1, expiresAt: 1 });
offerSchema.index({ company: 1, status: 1, createdAt: -1 });

offerSchema.statics.STATUSES = OFFER_STATUSES;
offerSchema.statics.ACTIONS = OFFER_ACTIONS;

module.exports = mongoose.model('Offer', offerSchema);
