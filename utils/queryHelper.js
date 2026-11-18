const crypto = require('node:crypto');




function escapeRegex(text = '') {
    return text.replace(/[-[\]{}()*+?.,\\^$|#]/g, '\\$&');
}



const MAX_LIST_ITEMS = 20;




const DEFAULT_LIMIT = 12;



const DURATION_BUCKETS = [
    { key: 'upto3', label: 'Up to 3 months', min: 0, max: 3 },
    { key: '3to6', label: '3 to 6 months', min: 3, max: 6 },
    { key: '6to12', label: '6 to 12 months', min: 6, max: 12 },
    { key: 'over12', label: 'Over 12 months', min: 12, max: Infinity }
];


function parseList(value) {
    const raw = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(',') : []);
    const seen = new Set();
    const list = [];

    raw.forEach(item => {
        if (typeof item !== 'string') return;
        const clean = item.trim();
        const key = clean.toLowerCase();
        if (!clean || seen.has(key)) return;
        seen.add(key);
        list.push(clean);
    });

    return list.slice(0, MAX_LIST_ITEMS);
}


function parseText(value, maxLength = 160) {
    const raw = Array.isArray(value) ? value[0] : value;
    return typeof raw === 'string' ? raw.trim().slice(0, maxLength) : '';
}


function parseAmount(value) {
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === undefined || raw === null || raw === '') return null;

    const amount = Number(String(raw).replace(/[,\s₹]/g, ''));
    if (!Number.isFinite(amount) || amount < 0) return null;
    return Math.floor(amount);
}


function normalizeSavedSearchCriteria(input = {}) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const validDurations = new Set(DURATION_BUCKETS.map(bucket => bucket.key));
    let minStipend = parseAmount(source.minStipend);
    let maxStipend = parseAmount(source.maxStipend);

    if (minStipend !== null && maxStipend !== null && minStipend > maxStipend) {
        [minStipend, maxStipend] = [maxStipend, minStipend];
    }

    return {
        search: parseText(source.search || source.q, 160),
        sector: parseText(source.sector, 80),
        location: parseText(source.location, 160),
        skills: parseList(source.skills),
        minStipend: minStipend === null ? '' : String(minStipend),
        maxStipend: maxStipend === null ? '' : String(maxStipend),
        duration: parseList(source.duration).filter(key => validDurations.has(key))
    };
}


function hasSavedSearchCriteria(criteria = {}) {
    const normalized = normalizeSavedSearchCriteria(criteria);
    return Boolean(
        normalized.search || normalized.sector || normalized.location ||
        normalized.skills.length || normalized.minStipend ||
        normalized.maxStipend || normalized.duration.length
    );
}


function getSavedSearchCriteriaHash(criteria = {}) {
    const normalized = normalizeSavedSearchCriteria(criteria);
    return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}


function buildSavedSearchResultsUrl(criteria = {}) {
    const normalized = normalizeSavedSearchCriteria(criteria);
    const params = new URLSearchParams();

    
    
    params.set('status', 'active');

    ['search', 'sector', 'location', 'minStipend', 'maxStipend'].forEach(key => {
        if (normalized[key]) params.set(key, normalized[key]);
    });
    if (normalized.skills.length) params.set('skills', normalized.skills.join(','));
    if (normalized.duration.length) params.set('duration', normalized.duration.join(','));

    const queryString = params.toString();
    return queryString ? `/internships?${queryString}` : '/internships';
}

function includesNormalized(haystack, needle) {
    return String(haystack || '').trim().toLowerCase().includes(String(needle || '').trim().toLowerCase());
}


function matchesInternshipCriteria(internship = {}, criteria = {}, now = new Date()) {
    const normalized = normalizeSavedSearchCriteria(criteria);
    if (!internship || internship.status !== 'published' || internship.isPaused === true) return false;

    const deadline = internship.applicationDeadline ? new Date(internship.applicationDeadline) : null;
    if (deadline && !Number.isNaN(deadline.getTime()) && deadline.getTime() < now.getTime()) return false;

    if (normalized.search) {
        const fields = [
            internship.title,
            internship.companyName || internship.company,
            internship.sector,
            ...(Array.isArray(internship.requiredSkills) ? internship.requiredSkills : [])
        ];
        if (!fields.some(field => includesNormalized(field, normalized.search))) return false;
    }

    if (normalized.sector && String(internship.sector || '').trim().toLowerCase() !== normalized.sector.toLowerCase()) return false;

    if (normalized.location) {
        const location = internship.location && typeof internship.location === 'object'
            ? [internship.location.district, internship.location.state]
            : [internship.location];
        if (!location.some(value => includesNormalized(value, normalized.location))) return false;
    }

    if (normalized.skills.length) {
        const requiredSkills = (Array.isArray(internship.requiredSkills) ? internship.requiredSkills : [])
            .map(skill => String(skill || '').trim().toLowerCase());
        if (!normalized.skills.some(skill => requiredSkills.includes(skill.toLowerCase()))) return false;
    }

    const stipend = Number(internship.monthlyStipend);
    if (normalized.minStipend && (!Number.isFinite(stipend) || stipend < Number(normalized.minStipend))) return false;
    if (normalized.maxStipend && (!Number.isFinite(stipend) || stipend > Number(normalized.maxStipend))) return false;

    if (normalized.duration.length) {
        const months = parseDurationMonths(internship.duration);
        if (!normalized.duration.some(key => isInDurationBucket(months, key))) return false;
    }

    return true;
}


function describeSavedSearchCriteria(criteria = {}) {
    const normalized = normalizeSavedSearchCriteria(criteria);
    const labels = [];
    if (normalized.search) labels.push(`Search: ${normalized.search}`);
    if (normalized.sector) labels.push(`Sector: ${normalized.sector}`);
    if (normalized.location) labels.push(`Location: ${normalized.location}`);
    normalized.skills.forEach(skill => labels.push(`Skill: ${skill}`));
    if (normalized.minStipend || normalized.maxStipend) {
        labels.push(`Stipend: ${formatStipendRange(normalized.minStipend, normalized.maxStipend)}`);
    }
    normalized.duration.forEach(key => {
        const bucket = DURATION_BUCKETS.find(item => item.key === key);
        if (bucket) labels.push(`Duration: ${bucket.label}`);
    });
    return labels;
}


function parseDurationMonths(text) {
    if (text === undefined || text === null) return null;

    const match = String(text).toLowerCase().match(/(\d+(?:\.\d+)?)\s*(years?|yrs?|months?|mos?|weeks?|wks?|days?)?/);
    if (!match) return null;

    const amount = parseFloat(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) return null;

    const unit = match[2] || 'month';
    if (unit.startsWith('y')) return amount * 12;
    if (unit.startsWith('w')) return (amount * 12) / 52;
    if (unit.startsWith('d')) return (amount * 12) / 365;
    return amount;
}


function isInDurationBucket(months, key) {
    const bucket = DURATION_BUCKETS.find(b => b.key === key);
    if (!bucket || months === null) return false;
    return months > bucket.min && months <= bucket.max;
}


function parseInternshipQuery(query = {}) {
    const search = parseText(query.search || query.q);
    const sector = parseText(query.sector, 80);
    const location = parseText(query.location);
    const status = parseText(query.status || query.filter, 24) || 'all'; 
    const sort = parseText(query.sort, 32) || 'latest';
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT);

    const skills = parseList(query.skills);
    const validDurations = new Set(DURATION_BUCKETS.map(b => b.key));
    const duration = parseList(query.duration).filter(key => validDurations.has(key));

    let minStipend = parseAmount(query.minStipend);
    let maxStipend = parseAmount(query.maxStipend);
    
    if (minStipend !== null && maxStipend !== null && minStipend > maxStipend) {
        [minStipend, maxStipend] = [maxStipend, minStipend];
    }

    const conditions = [];

    
    if (status === 'active') {
        conditions.push({
            status: { $nin: ['draft', 'paused'] },
            isPaused: { $ne: true }
        });
    } else if (status === 'paused') {
        conditions.push({
            $or: [{ status: 'paused' }, { isPaused: true }]
        });
    } else {
        
        conditions.push({ status: { $ne: 'draft' } });
    }

    
    if (search) {
        const searchRegex = new RegExp(escapeRegex(search), 'i');
        conditions.push({
            $or: [
                { title: searchRegex },
                { companyName: searchRegex },
                { sector: searchRegex },
                { requiredSkills: searchRegex }
            ]
        });
    }

    
    if (sector && sector !== 'all') {
        conditions.push({ sector: new RegExp(`^${escapeRegex(sector)}$`, 'i') });
    }

    
    if (location) {
        const locRegex = new RegExp(escapeRegex(location), 'i');
        conditions.push({
            $or: [
                { 'location.district': locRegex },
                { 'location.state': locRegex },
                { location: locRegex }
            ]
        });
    }

    
    
    if (skills.length) {
        conditions.push({
            requiredSkills: { $in: skills.map(skill => new RegExp(`^${escapeRegex(skill)}$`, 'i')) }
        });
    }

    
    if (minStipend !== null || maxStipend !== null) {
        const range = {};
        if (minStipend !== null) range.$gte = minStipend;
        if (maxStipend !== null) range.$lte = maxStipend;
        conditions.push({ monthlyStipend: range });
    }

    
    

    
    const filterObj = conditions.length === 1 ? conditions[0] : { $and: conditions };

    
    let sortObj = { _id: -1 };
    if (sort === 'stipend_high') {
        sortObj = { monthlyStipend: -1, _id: -1 };
    } else if (sort === 'stipend_low') {
        sortObj = { monthlyStipend: 1, _id: -1 };
    } else if (sort === 'vacancies') {
        sortObj = { vacancies: -1, _id: -1 };
    } else {
        sortObj = { createdAt: -1, _id: -1 };
    }

    
    
    const state = {
        search,
        sector,
        location,
        status,
        sort,
        page,
        limit,
        skills,
        minStipend: minStipend === null ? '' : String(minStipend),
        maxStipend: maxStipend === null ? '' : String(maxStipend),
        duration
    };

    return { filterObj, sortObj, state, page, limit };
}


function getPaginationRange(currentPage, totalPages) {
    if (totalPages <= 7) {
        return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    if (currentPage <= 4) {
        return [1, 2, 3, 4, 5, '...', totalPages];
    }
    if (currentPage >= totalPages - 3) {
        return [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    }
    return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages];
}


function buildPaginationData(totalItems, currentPage, limit = DEFAULT_LIMIT) {
    const validTotal = Math.max(0, parseInt(totalItems, 10) || 0);
    const validLimit = Math.max(1, parseInt(limit, 10) || DEFAULT_LIMIT);
    const totalPages = Math.max(1, Math.ceil(validTotal / validLimit));
    const page = Math.max(1, Math.min(parseInt(currentPage, 10) || 1, totalPages));
    const skip = (page - 1) * validLimit;
    const startItem = validTotal === 0 ? 0 : skip + 1;
    const endItem = Math.min(skip + validLimit, validTotal);

    return {
        totalItems: validTotal,
        totalPages,
        currentPage: page,
        limit: validLimit,
        skip,
        startItem,
        endItem,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
        nextPage: page + 1,
        prevPage: page - 1,
        pages: getPaginationRange(page, totalPages)
    };
}


function buildQueryString(currentParams = {}, overrides = {}) {
    const params = new URLSearchParams();
    const merged = { ...currentParams, ...overrides };

    Object.keys(merged).forEach(key => {
        let val = merged[key];
        
        if (Array.isArray(val)) {
            if (!val.length) return;
            val = val.join(',');
        }
        if (
            val !== undefined &&
            val !== null &&
            val !== '' &&
            !(key === 'page' && Number(val) <= 1) &&
            !(key === 'sort' && val === 'latest') &&
            !(key === 'sector' && val === 'all') &&
            !(key === 'status' && val === 'all') &&
            !(key === 'limit' && Number(val) === DEFAULT_LIMIT)
        ) {
            params.set(key, val);
        }
    });

    const queryString = params.toString();
    return queryString ? `?${queryString}` : '/internships';
}


async function applyDurationFilter(filterObj, durationKeys, Model) {
    if (!Array.isArray(durationKeys) || !durationKeys.length) return filterObj;

    const docs = await Model.find(filterObj).select('_id duration').lean();
    const ids = docs
        .filter(doc => {
            const months = parseDurationMonths(doc.duration);
            return durationKeys.some(key => isInDurationBucket(months, key));
        })
        .map(doc => doc._id);

    return { $and: [filterObj, { _id: { $in: ids } }] };
}


function formatStipendRange(min, max) {
    const rupees = value => '₹' + Number(value).toLocaleString('en-IN');
    if (min && max) return `${rupees(min)} – ${rupees(max)}`;
    if (min) return `${rupees(min)}+`;
    return `Up to ${rupees(max)}`;
}


function getActiveFilters(state = {}) {
    const base = { ...state, page: 1 };
    const chips = [];

    if (state.sector && state.sector !== 'all') {
        chips.push({ key: 'sector', label: `Industry: ${state.sector}`, href: buildQueryString(base, { sector: '' }) });
    }
    if (state.location) {
        chips.push({ key: 'location', label: `Location: ${state.location}`, href: buildQueryString(base, { location: '' }) });
    }
    (state.skills || []).forEach(skill => {
        chips.push({
            key: 'skills',
            label: `Skill: ${skill}`,
            href: buildQueryString(base, { skills: state.skills.filter(s => s !== skill) })
        });
    });
    if (state.minStipend || state.maxStipend) {
        chips.push({
            key: 'stipend',
            label: `Stipend: ${formatStipendRange(state.minStipend, state.maxStipend)}`,
            href: buildQueryString(base, { minStipend: '', maxStipend: '' })
        });
    }
    (state.duration || []).forEach(key => {
        const bucket = DURATION_BUCKETS.find(b => b.key === key);
        if (!bucket) return;
        chips.push({
            key: 'duration',
            label: `Duration: ${bucket.label}`,
            href: buildQueryString(base, { duration: state.duration.filter(d => d !== key) })
        });
    });

    return chips;
}


function clearFiltersHref(state = {}) {
    return buildQueryString(state, {
        sector: '',
        location: '',
        skills: [],
        minStipend: '',
        maxStipend: '',
        duration: [],
        page: 1
    });
}


function uniqueSortedOptions(values = []) {
    const seen = new Map();
    values.forEach(value => {
        if (typeof value !== 'string') return;
        const clean = value.trim();
        const key = clean.toLowerCase();
        if (clean && !seen.has(key)) seen.set(key, clean);
    });
    return [...seen.values()].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

module.exports = {
    DEFAULT_LIMIT,
    escapeRegex,
    parseText,
    parseInternshipQuery,
    getPaginationRange,
    buildPaginationData,
    buildQueryString,
    DURATION_BUCKETS,
    parseList,
    parseAmount,
    parseDurationMonths,
    isInDurationBucket,
    applyDurationFilter,
    getActiveFilters,
    clearFiltersHref,
    uniqueSortedOptions,
    normalizeSavedSearchCriteria,
    hasSavedSearchCriteria,
    getSavedSearchCriteriaHash,
    buildSavedSearchResultsUrl,
    matchesInternshipCriteria,
    describeSavedSearchCriteria
};
