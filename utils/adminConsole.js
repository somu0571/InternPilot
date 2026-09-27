const CONSOLE_ROLES = ['candidate', 'company', 'recruiter', 'hiring_manager', 'admin'];
const CONSOLE_RANGES = [7, 30, 90];
const FUNNEL_STATUSES = ['Submitted', 'Under Review', 'Shortlisted', 'Interview', 'Hired'];

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizedText(value, maxLength = 200) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function parseRange(value) {
    const parsed = Number.parseInt(value, 10);
    return CONSOLE_RANGES.includes(parsed) ? parsed : 30;
}

function rangeWindow(days, now = new Date()) {
    const end = new Date(now);
    const start = new Date(end);
    start.setDate(start.getDate() - days);
    const previousStart = new Date(start);
    previousStart.setDate(previousStart.getDate() - days);
    return { start, end, previousStart, previousEnd: start };
}

function percentageChange(current, previous) {
    if (!previous) return current ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
}

function normalizeApplicationStatus(status) {
    return String(status || '').toLowerCase() === 'pending' ? 'Submitted' : String(status || 'Submitted');
}

function buildFunnel(statusCounts = {}) {
    let previous = null;
    return FUNNEL_STATUSES.map(status => {
        const count = Number(statusCounts[status] || 0);
        const conversion = previous === null ? 100 : (previous ? Math.round((count / previous) * 100) : 0);
        previous = count;
        return { status, count, conversion };
    });
}

function listingRiskFlags(listing = {}) {
    const description = String(listing.description || '');
    const combined = `${listing.title || ''} ${description}`;
    const flags = [];
    const add = (code, label, severity = 'medium') => flags.push({ code, label, severity });

    if (/\b(fee|deposit|registration\s+charge|pay\s+(?:to|for)|payment\s+required)\b/i.test(combined)) {
        add('fee_or_deposit', 'Mentions a fee, deposit, or payment requirement', 'high');
    }
    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(description)) {
        add('contact_email', 'Contains an email address in the description');
    }
    if (/(?:\+?\d[\d\s().-]{7,}\d)/.test(description)) {
        add('contact_phone', 'Contains a phone number in the description');
    }

    const vacancies = Number(listing.vacancies);
    if (!Number.isFinite(vacancies) || vacancies < 1 || vacancies > 100000) {
        add('impossible_openings', 'Openings count is missing or outside the supported range', 'high');
    }
    const stipend = Number(listing.monthlyStipend);
    if (!Number.isFinite(stipend) || stipend < 0 || stipend > 1000000) {
        add('impossible_stipend', 'Monthly stipend is missing or outside the supported range', 'high');
    }
    const durationMatch = String(listing.duration || '').match(/(\d+(?:\.\d+)?)/);
    const duration = durationMatch ? Number(durationMatch[1]) : NaN;
    if (!Number.isFinite(duration) || duration <= 0 || duration > 60) {
        add('impossible_duration', 'Duration is missing or outside 1–60 months', 'high');
    }
    if (description.trim().length < 80) {
        add('short_description', 'Description is shorter than 80 characters');
    }
    const company = listing.companyId || listing.company;
    if (!company || !company.companyDetails || company.companyDetails.isVerified !== true) {
        add('unverified_company', 'Company is not verified', 'high');
    }
    return flags;
}

function isSuspensionEligible(user, actorId) {
    if (!user) return false;
    if (String(user._id) === String(actorId)) return false;
    return ['candidate', 'recruiter', 'hiring_manager'].includes(user.role);
}

function announcementVisibleTo(announcement, user) {
    if (!announcement) return false;
    if (announcement.audience === 'all') return true;
    if (announcement.audience === 'candidates') return user?.role === 'candidate';
    return ['company', 'recruiter', 'hiring_manager'].includes(user?.role);
}

function csvCell(value) {
    const output = String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/"/g, '""');
    const safe = /^[=+\-@]/.test(output) ? `'${output}` : output;
    return `"${safe}"`;
}

function toCsv(headers, rows) {
    return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}

function safeJson(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

module.exports = {
    CONSOLE_ROLES,
    FUNNEL_STATUSES,
    escapeRegex,
    normalizedText,
    parseRange,
    rangeWindow,
    percentageChange,
    normalizeApplicationStatus,
    buildFunnel,
    listingRiskFlags,
    isSuspensionEligible,
    announcementVisibleTo,
    csvCell,
    toCsv,
    safeJson
};
