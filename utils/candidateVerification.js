const CandidateVerification = require('../models/CandidateVerification');

const VERIFICATION_STATUSES = ['pending', 'approved', 'rejected', 'suspended'];
const REVIEW_STATUSES = ['approved', 'rejected', 'suspended'];



const REVIEW_TRANSITIONS = {
    pending: new Set(['approved', 'rejected', 'suspended']),
    approved: new Set(['suspended']),
    rejected: new Set(['approved', 'suspended']),
    suspended: new Set(['approved', 'rejected'])
};

class CandidateVerificationError extends Error {
    constructor(message, code = 'CANDIDATE_VERIFICATION_ERROR', statusCode = 400) {
        super(message);
        this.name = 'CandidateVerificationError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function normalizeReviewReason(value) {
    return typeof value === 'string' ? value.trim().slice(0, 1000) : '';
}

function maskIdentifier(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length < 4) {
        throw new CandidateVerificationError('Enter the last four digits of the identity document.', 'INVALID_MASKED_IDENTIFIER');
    }
    return `•••• ${digits.slice(-4)}`;
}

function verificationStatus(verification) {
    return VERIFICATION_STATUSES.includes(verification?.status) ? verification.status : 'pending';
}

function isCandidateVerified(verification) {
    return verificationStatus(verification) === 'approved';
}

function statusLabel(status) {
    const value = verificationStatus({ status });
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function applyCandidateVerificationDecision(verification, status, { reviewerId, reason, at = new Date() } = {}) {
    if (!REVIEW_STATUSES.includes(status)) {
        throw new CandidateVerificationError('Invalid verification review status.', 'INVALID_VERIFICATION_STATUS');
    }

    const normalizedReason = normalizeReviewReason(reason);
    if (!normalizedReason) {
        throw new CandidateVerificationError('A review reason is required for every verification decision.', 'VERIFICATION_REASON_REQUIRED');
    }

    const previousStatus = verificationStatus(verification);
    if (!REVIEW_TRANSITIONS[previousStatus]?.has(status)) {
        throw new CandidateVerificationError(
            `Verification cannot move from ${statusLabel(previousStatus)} to ${statusLabel(status)}.`,
            'INVALID_VERIFICATION_TRANSITION'
        );
    }

    verification.status = status;
    verification.reviewerReason = normalizedReason;
    verification.reviewedAt = at;
    verification.reviewedBy = reviewerId || undefined;
    verification.history = Array.isArray(verification.history) ? verification.history : [];
    verification.history.push({
        fromStatus: previousStatus,
        toStatus: status,
        reason: normalizedReason,
        changedBy: reviewerId || undefined,
        actorRole: 'admin',
        changedAt: at
    });
    return verification;
}

function submitCandidateVerification(verification, { candidateId, documents, maskedIdentifier, at = new Date() } = {}) {
    if (!Array.isArray(documents) || documents.length === 0) {
        throw new CandidateVerificationError('Upload at least one verification document.', 'VERIFICATION_DOCUMENT_REQUIRED');
    }

    const previousStatus = verificationStatus(verification);
    if (!verification.isNew && ['approved', 'suspended'].includes(previousStatus)) {
        throw new CandidateVerificationError(
            `Documents cannot be resubmitted while verification is ${statusLabel(previousStatus)}.`,
            'VERIFICATION_RESUBMISSION_BLOCKED',
            409
        );
    }

    verification.candidate = candidateId || verification.candidate;
    verification.status = 'pending';
    verification.documents = documents;
    verification.maskedIdentifier = maskedIdentifier;
    verification.reviewerReason = '';
    verification.submittedAt = at;
    verification.reviewedAt = undefined;
    verification.reviewedBy = undefined;
    verification.history = Array.isArray(verification.history) ? verification.history : [];
    verification.history.push({
        fromStatus: verification.isNew ? undefined : previousStatus,
        toStatus: 'pending',
        reason: 'Verification documents submitted.',
        changedBy: candidateId || verification.candidate,
        actorRole: 'candidate',
        changedAt: at
    });
    return verification;
}

async function assertCandidateVerified(candidateId, CandidateVerificationModel = CandidateVerification) {
    const verification = await CandidateVerificationModel.findOne({ candidate: candidateId });
    if (isCandidateVerified(verification)) return verification;

    const status = statusLabel(verificationStatus(verification));
    throw new CandidateVerificationError(
        `Your identity and PMIS documents must be approved before you can continue. Current verification status: ${status}.`,
        'CANDIDATE_VERIFICATION_REQUIRED',
        403
    );
}

module.exports = {
    VERIFICATION_STATUSES,
    REVIEW_STATUSES,
    REVIEW_TRANSITIONS,
    CandidateVerificationError,
    normalizeReviewReason,
    maskIdentifier,
    verificationStatus,
    isCandidateVerified,
    statusLabel,
    applyCandidateVerificationDecision,
    submitCandidateVerification,
    assertCandidateVerified
};
