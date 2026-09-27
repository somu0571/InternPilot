const Internship = require('../models/Internship');

const COMPANY_VERIFICATION_STATUSES = ['pending', 'approved', 'rejected', 'suspended'];

function companyVerificationStatus(company) {
    const storedStatus = company?.companyDetails?.verificationStatus;
    if (COMPANY_VERIFICATION_STATUSES.includes(storedStatus)) return storedStatus;

    // Preserve access for organisations approved before verificationStatus
    // was introduced. The next review writes the explicit state.
    return company?.companyDetails?.isVerified ? 'approved' : 'pending';
}

function isCompanyVerified(company) {
    return companyVerificationStatus(company) === 'approved';
}

function normalizeVerificationReason(value) {
    return typeof value === 'string' ? value.trim().slice(0, 1000) : '';
}

function applyCompanyVerificationDecision(company, status, { reviewerId, reason, at = new Date() } = {}) {
    if (!COMPANY_VERIFICATION_STATUSES.includes(status)) {
        throw new Error('Invalid company verification status.');
    }

    if (!company.companyDetails) company.companyDetails = {};

    const normalizedReason = normalizeVerificationReason(reason);
    company.companyDetails.verificationStatus = status;
    company.companyDetails.isVerified = status === 'approved';
    company.companyDetails.verificationReason = normalizedReason;
    company.companyDetails.verificationReviewedAt = at;
    company.companyDetails.verificationReviewedBy = reviewerId || undefined;

    if (!Array.isArray(company.companyDetails.verificationHistory)) {
        company.companyDetails.verificationHistory = [];
    }
    company.companyDetails.verificationHistory.push({
        status,
        reason: normalizedReason,
        changedBy: reviewerId || undefined,
        changedAt: at
    });

    return company;
}

function startCompanyReverification(company, { submittedBy, at = new Date() } = {}) {
    if (!company.companyDetails) company.companyDetails = {};
    company.companyDetails.verificationStatus = 'pending';
    company.companyDetails.isVerified = false;
    company.companyDetails.verificationReason = '';
    company.companyDetails.verificationSubmittedAt = at;
    company.companyDetails.verificationReviewedAt = undefined;
    company.companyDetails.verificationReviewedBy = undefined;

    if (!Array.isArray(company.companyDetails.verificationHistory)) {
        company.companyDetails.verificationHistory = [];
    }
    company.companyDetails.verificationHistory.push({
        status: 'pending',
        reason: 'Verification documents submitted.',
        changedBy: submittedBy || undefined,
        changedAt: at
    });

    return company;
}

async function unpublishCompanyListings(companyId, { session } = {}) {
    return Internship.updateMany(
        {
            $or: [
                { companyId },
                { companyId: null, postedBy: companyId }
            ],
            status: { $in: ['published', 'paused'] }
        },
        {
            $set: {
                status: 'closed',
                isPaused: false
            }
        },
        session ? { session } : undefined
    );
}

module.exports = {
    COMPANY_VERIFICATION_STATUSES,
    companyVerificationStatus,
    isCompanyVerified,
    normalizeVerificationReason,
    applyCompanyVerificationDecision,
    startCompanyReverification,
    unpublishCompanyListings
};
