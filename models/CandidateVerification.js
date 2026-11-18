const mongoose = require('mongoose');

const VERIFICATION_STATUSES = ['pending', 'approved', 'rejected', 'suspended'];




const verificationDocumentSchema = new mongoose.Schema({
    documentType: {
        type: String,
        enum: ['identity', 'education', 'income', 'other'],
        required: true
    },
    fileName: { type: String, required: true, trim: true, maxlength: 180 },
    storageKey: { type: String, required: true, trim: true, maxlength: 500 },
    fileUrl: { type: String, default: '', trim: true, maxlength: 2000 },
    uploadedAt: { type: Date, default: Date.now }
}, { _id: false });

const verificationHistorySchema = new mongoose.Schema({
    fromStatus: { type: String, enum: VERIFICATION_STATUSES },
    toStatus: { type: String, enum: VERIFICATION_STATUSES, required: true },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorRole: { type: String, enum: ['candidate', 'admin', 'system'], required: true },
    changedAt: { type: Date, default: Date.now }
}, { _id: false });

const candidateVerificationSchema = new mongoose.Schema({
    candidate: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
        index: true
    },
    status: {
        type: String,
        enum: VERIFICATION_STATUSES,
        default: 'pending',
        required: true,
        index: true
    },
    documents: { type: [verificationDocumentSchema], default: [] },
    
    maskedIdentifier: {
        type: String,
        default: '',
        trim: true,
        maxlength: 16,
        validate: {
            validator: value => !value || /^•••• \d{4}$/.test(value),
            message: 'Only a masked last-four identifier may be stored.'
        }
    },
    reviewerReason: { type: String, default: '', trim: true, maxlength: 1000 },
    submittedAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    history: { type: [verificationHistorySchema], default: [] }
}, { timestamps: true });

candidateVerificationSchema.index({ status: 1, submittedAt: 1 });
candidateVerificationSchema.index({ candidate: 1, status: 1 });

const CandidateVerification = mongoose.model('CandidateVerification', candidateVerificationSchema);

module.exports = CandidateVerification;
module.exports.VERIFICATION_STATUSES = VERIFICATION_STATUSES;
