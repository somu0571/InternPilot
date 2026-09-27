const MAX_SEARCH_LENGTH = 120;

const STATUS_FILTERS = [
    'Submitted',
    'Under Review',
    'Shortlisted',
    'Interview',
    'Rejected',
    'Hired',
    'Offer Declined',
    'Withdrawn'
];

const SORT_OPTIONS = ['recent', 'oldest', 'company'];

function firstText(value, maxLength = MAX_SEARCH_LENGTH) {
    const raw = Array.isArray(value) ? value[0] : value;
    return typeof raw === 'string' ? raw.trim().slice(0, maxLength) : '';
}

function canonicalStatus(value) {
    const normalized = String(value || '').trim().toLowerCase().replace(/[_-]/g, ' ');
    const aliases = {
        pending: 'Submitted',
        submitted: 'Submitted',
        'under review': 'Under Review',
        shortlisted: 'Shortlisted',
        interview: 'Interview',
        rejected: 'Rejected',
        hired: 'Hired',
        accepted: 'Hired',
        'offer declined': 'Offer Declined',
        withdrawn: 'Withdrawn'
    };
    return aliases[normalized] || '';
}

/**
 * Parses only the supported controls on My Applications. This keeps query
 * values predictable for links, browser history, and both application routes.
 */
function parseApplicationSearch(query = {}) {
    const search = firstText(query.search);
    const requestedStatus = firstText(query.status, 32);
    const requestedSort = firstText(query.sort, 32);
    const status = requestedStatus.toLowerCase() === 'all'
        ? 'all'
        : (canonicalStatus(requestedStatus) || 'all');
    const sort = SORT_OPTIONS.includes(requestedSort) ? requestedSort : 'recent';

    return { search, status, sort };
}

function applicationMatchesSearch(application, search) {
    if (!search) return true;

    const term = search.toLowerCase();
    const internship = application && application.internship ? application.internship : {};
    return [internship.title, internship.companyName || internship.company]
        .some(value => String(value || '').toLowerCase().includes(term));
}

function asTimestamp(value) {
    const timestamp = new Date(value || 0).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareApplications(sort) {
    if (sort === 'oldest') {
        return (left, right) => asTimestamp(left.appliedAt) - asTimestamp(right.appliedAt)
            || String(left._id || '').localeCompare(String(right._id || ''));
    }

    if (sort === 'company') {
        return (left, right) => {
            const leftInternship = left.internship || {};
            const rightInternship = right.internship || {};
            const leftCompany = String(leftInternship.companyName || leftInternship.company || '');
            const rightCompany = String(rightInternship.companyName || rightInternship.company || '');
            const companyOrder = leftCompany.localeCompare(rightCompany, undefined, { sensitivity: 'base' });
            if (companyOrder) return companyOrder;
            return String(leftInternship.title || '').localeCompare(String(rightInternship.title || ''), undefined, { sensitivity: 'base' });
        };
    }

    return (left, right) => {
        const rightUpdated = asTimestamp(right.statusUpdatedAt || right.appliedAt);
        const leftUpdated = asTimestamp(left.statusUpdatedAt || left.appliedAt);
        return rightUpdated - leftUpdated
            || asTimestamp(right.appliedAt) - asTimestamp(left.appliedAt)
            || String(right._id || '').localeCompare(String(left._id || ''));
    };
}

/**
 * Filters populated candidate applications by internship title/company and
 * application status, then applies the selected order. Filtering after
 * populate deliberately keeps applications with deleted listings visible when
 * no search is active.
 */
function filterAndSortApplications(applications, query = {}) {
    const state = parseApplicationSearch(query);
    const input = Array.isArray(applications) ? applications : [];
    const filtered = input.filter(application => (
        applicationMatchesSearch(application, state.search)
        && (state.status === 'all' || canonicalStatus(application.status) === state.status)
    ));

    return {
        ...state,
        totalApplications: input.length,
        applications: filtered.slice().sort(compareApplications(state.sort))
    };
}

module.exports = {
    STATUS_FILTERS,
    SORT_OPTIONS,
    canonicalStatus,
    parseApplicationSearch,
    applicationMatchesSearch,
    filterAndSortApplications
};
