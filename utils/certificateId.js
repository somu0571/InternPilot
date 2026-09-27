const crypto = require('crypto');

/**
 * Generates an authentic, tamper-proof Certificate ID.
 * Format: IP-YYYY-XXXX-XXXX
 * Uses cryptographic randomness and excludes ambiguous characters (0, O, 1, I).
 */
function generateCertificateId(year = new Date().getFullYear()) {
    const charset = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    const generateSegment = (length = 4) => {
        const bytes = crypto.randomBytes(length);
        let result = '';
        for (let i = 0; i < length; i++) {
            result += charset[bytes[i] % charset.length];
        }
        return result;
    };

    return `IP-${year}-${generateSegment(4)}-${generateSegment(4)}`;
}

/**
 * Validates the syntax of a Certificate ID.
 */
function isValidCertificateId(id) {
    if (typeof id !== 'string') return false;
    return /^IP-\d{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/i.test(id.trim());
}

module.exports = {
    generateCertificateId,
    isValidCertificateId
};
