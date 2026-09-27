const mongoose = require('mongoose');
const Internship = require('../models/Internship');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { logAdminAction, registerNotificationTypes } = require('./adminAudit');

registerNotificationTypes('listing_moderation');

// Checks that point an admin at listings worth a look. They only flag;
// nothing is hidden automatically.
const RISK_RULES = {
    fees: { label: 'Asks for a fee or deposit', severity: 'high' },
    openings: { label: 'Impossible number of openings', severity: 'high' },
    stipend: { label: 'Stipend looks wrong', severity: 'medium' },
    duration: { label: 'Duration looks wrong', severity: 'medium' },
    contact: { label: 'Phone, email or chat link in the text', severity: 'medium' },
    unverified: { label: 'Company not verified', severity: 'medium' },
    thin: { label: 'Very short description', severity: 'low' }
};
const SEVERITY_RANK = { high: 3, medium: 2, low: 1, none: 0 };

// PMIS internships are free to apply for; any fee or deposit is a red flag.
const FEE_PATTERN = /\b(?:registration|processing|training|joining|application|kit|onboarding|enrol?ment)\s+(?:fees?|charges?)\b|\b(?:security|refundable|caution)\s+(?:deposit|amount|fees?)\b|\bpay\s+(?:a\s+)?(?:fees?|deposit|rs\.?|inr|₹)/i;
const PHONE_PATTERN = /(?:\+?91[\s-]?)?\b[6-9]\d{9}\b/;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const CHAT_PATTERN = /wa\.me|whatsapp|t\.me\/|telegram/i;

/** "12 Months", "1 Year", "6 weeks", "3" -> months, or null if it can't be read. */
function durationInMonths(text) {
    const match = String(text || '').trim().match(/^(\d{1,3})(?:\.\d+)?\s*(months?|mos?|weeks?|wks?|years?|yrs?|days?)?$/i);
    if (!match) return null;
    const n = Number(match[1]);
    const unit = (match[2] || 'month').toLowerCase();
    if (unit.startsWith('w')) return n / 4.345;
    if (unit.startsWith('y')) return n * 12;
    if (unit.startsWith('d')) return n / 30;
    return n;
}

/**
 * @param {object} listing Internship (plain or document).
 * @param {object|null} owner The company account, for the verification check.
 * @returns {Array<{id,label,severity}>}
 */
function assessListing(listing = {}, owner = null) {
    const text = [listing.title, listing.description, ...(listing.responsibilities || []), ...(listing.eligibilityCriteria || [])]
        .filter(Boolean).join('\n');
    const flags = [];

    if (FEE_PATTERN.test(text)) flags.push('fees');
    const openings = Number(listing.vacancies);
    if (!Number.isFinite(openings) || openings < 1 || openings > 500) flags.push('openings');
    const stipend = Number(listing.monthlyStipend);
    if (!Number.isFinite(stipend) || stipend < 1000 || stipend > 100000) flags.push('stipend');
    const months = durationInMonths(listing.duration);
    if (months === null || months < 0.25 || months > 24) flags.push('duration');
    if (PHONE_PATTERN.test(text) || EMAIL_PATTERN.test(text) || CHAT_PATTERN.test(text)) flags.push('contact');
    if (owner && !(owner.companyDetails && owner.companyDetails.isVerified)) flags.push('unverified');
    if (String(listing.description || '').trim().length < 60) flags.push('thin');

    return flags.map(id => ({ id, ...RISK_RULES[id] }));
}

function riskLevel(flags = []) {
    return flags.reduce((top, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[top] ? f.severity : top), 'none');
}

const MODERATION = {
    pause: { from: ['published'], to: 'paused', action: 'listing.pause', verb: 'paused', needsReason: true },
    close: { from: ['published', 'paused'], to: 'closed', action: 'listing.close', verb: 'closed', needsReason: true },
    restore: { from: ['paused', 'closed'], to: 'published', action: 'listing.restore', verb: 'restored', needsReason: false }
};

const ownerIdOf = listing => listing.companyId || listing.postedBy || null;

/**
 * Pause, close or restore a listing. The status only changes if it is still
 * what the admin saw, and the company is told why.
 */
async function moderateListing(admin, listingId, actionKey, text, now = new Date()) {
    const rule = MODERATION[actionKey];
    if (!rule) return { error: 'Unknown action.' };
    if (!mongoose.Types.ObjectId.isValid(listingId)) return { error: 'Listing not found.' };

    const listing = await Internship.findById(listingId).select('title status companyId postedBy publishedAt').lean();
    if (!listing) return { error: 'Listing not found.' };
    if (!rule.from.includes(listing.status)) return { error: `A ${listing.status} listing can't be ${rule.verb}.` };

    const reason = String(text || '').trim();
    if (rule.needsReason && reason.length < 10) return { error: 'Give a reason of at least 10 characters. The company will see it.' };
    if (reason.length > 1000) return { error: 'Keep the reason under 1000 characters.' };

    const ownerId = ownerIdOf(listing);
    if (actionKey === 'restore') {
        const owner = ownerId ? await User.findById(ownerId).select('companyDetails.isVerified').lean() : null;
        if (!owner || !(owner.companyDetails && owner.companyDetails.isVerified)) {
            return { error: 'Verify the company before putting its listing back live.' };
        }
    }

    // Status and isPaused are set together, the same way the model keeps them in step.
    const update = { status: rule.to, isPaused: rule.to === 'paused' };
    if (rule.to === 'published') update.publishedAt = now;
    const result = await Internship.updateOne({ _id: listing._id, status: listing.status }, { $set: update });
    if (!result.modifiedCount) return { error: 'The listing changed while you were looking at it. Reload and try again.' };

    await logAdminAction(admin, {
        action: rule.action,
        targetType: 'internship',
        targetId: listing._id,
        targetLabel: listing.title,
        reason,
        details: { from: listing.status, to: rule.to }
    });

    if (ownerId) {
        try {
            await Notification.create({
                companyId: ownerId,
                type: 'listing_moderation',
                title: `Your listing was ${rule.verb} by an admin`,
                message: reason ? `"${listing.title}": ${reason}` : `"${listing.title}" is live again.`,
                link: '/company/dashboard'
            });
        } catch (err) {
            console.error('Could not notify the company about moderation:', err);
        }
    }
    return { ok: true, from: listing.status, to: rule.to };
}

const REVIEW_STATUSES = ['published', 'paused', 'closed', 'draft'];
const REVIEW_SCAN = 500;
const REVIEW_PAGE = 30;
const escapeRegExp = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Newest listings with their flags. Flags depend on text and the owner, so
 * the newest REVIEW_SCAN listings for the chosen status are checked and the
 * risk filter is applied to those.
 */
async function listingsForReview({ status, risk, q, page } = {}) {
    const query = {};
    query.status = REVIEW_STATUSES.includes(status) ? status : (status === 'all' ? { $in: REVIEW_STATUSES } : 'published');
    const search = String(q || '').trim().slice(0, 80);
    if (search) {
        const pattern = new RegExp(escapeRegExp(search), 'i');
        query.$or = [{ title: pattern }, { companyName: pattern }];
    }

    const listings = await Internship.find(query)
        .sort({ _id: -1 })
        .limit(REVIEW_SCAN)
        .select('title companyName status vacancies monthlyStipend duration description responsibilities eligibilityCriteria companyId postedBy location')
        .lean();

    const ownerIds = [...new Set(listings.map(l => String(ownerIdOf(l) || '')).filter(Boolean))];
    const owners = await User.find({ _id: { $in: ownerIds } }).select('name companyDetails.isVerified companyDetails.companyName').lean();
    const ownerMap = new Map(owners.map(o => [String(o._id), o]));

    const assessed = listings.map(l => {
        const owner = ownerMap.get(String(ownerIdOf(l) || '')) || null;
        const flags = assessListing(l, owner);
        return { ...l, owner, flags, risk: riskLevel(flags) };
    });

    const counts = { all: assessed.length, high: 0, medium: 0, low: 0, none: 0 };
    assessed.forEach(l => { counts[l.risk] += 1; });

    const minimum = { high: 3, medium: 2, flagged: 1 }[risk] || 0;
    const filtered = minimum ? assessed.filter(l => SEVERITY_RANK[l.risk] >= minimum) : assessed;
    const pages = Math.max(1, Math.ceil(filtered.length / REVIEW_PAGE));
    const current = Math.min(pages, Math.max(1, parseInt(page, 10) || 1));
    return {
        items: filtered.slice((current - 1) * REVIEW_PAGE, current * REVIEW_PAGE),
        counts,
        page: current,
        pages,
        scanned: assessed.length,
        scanLimit: REVIEW_SCAN
    };
}

module.exports = {
    RISK_RULES,
    SEVERITY_RANK,
    MODERATION,
    REVIEW_STATUSES,
    durationInMonths,
    assessListing,
    riskLevel,
    moderateListing,
    listingsForReview
};
