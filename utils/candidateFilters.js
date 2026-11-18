

const MAX_LIST_ITEMS = 20;



const STATUS_ORDER = ['Submitted', 'Under Review', 'Shortlisted', 'Interview', 'Hired', 'Offer Declined', 'Rejected', 'Withdrawn'];
const STATUS_ALIASES = { pending: 'Submitted', withdrawn: 'Withdrawn' };



const EXPERIENCE_LEVELS = [
    { key: '1', min: 1, label: '1+ projects or certifications' },
    { key: '3', min: 3, label: '3+ projects or certifications' },
    { key: '5', min: 5, label: '5+ projects or certifications' }
];

const MATCH_STEPS = [25, 50, 75, 90];


function parseList(value) {
    const raw = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
    const seen = new Set();
    const list = [];
    raw.forEach(item => {
        if (typeof item !== 'string') return;
        const clean = item.trim();
        if (!clean || seen.has(clean.toLowerCase())) return;
        seen.add(clean.toLowerCase());
        list.push(clean);
    });
    return list.slice(0, MAX_LIST_ITEMS);
}


function normalizeStatus(status) {
    const value = String(status || '').trim();
    if (STATUS_ORDER.includes(value)) return value;
    return STATUS_ALIASES[value.toLowerCase()] || value;
}


function candidateSkills(candidate) {
    if (!candidate) return [];
    const profiles = Array.isArray(candidate.skillProfiles) ? candidate.skillProfiles : [];
    const names = profiles.length ? profiles.map(p => p && p.name) : (candidate.skills || []);
    return names.filter(name => typeof name === 'string' && name.trim()).map(name => name.trim());
}


function candidateLocation(candidate) {
    const loc = candidate && candidate.location;
    if (!loc) return '';
    if (typeof loc === 'string') return loc.trim();
    return [loc.district, loc.state].filter(Boolean).map(s => String(s).trim()).filter(Boolean).join(', ');
}


function candidateQualification(candidate) {
    if (!candidate) return '';
    const value = (candidate.education && candidate.education.qualification) || candidate.qualification || '';
    return String(value).trim();
}


function portfolioSize(candidate) {
    if (!candidate) return 0;
    const count = list => (Array.isArray(list) ? list.length : 0);
    return count(candidate.projects) + count(candidate.certifications);
}


function parseCandidateFilters(query = {}) {
    const status = parseList(query.status)
        .map(normalizeStatus)
        .filter(s => STATUS_ORDER.includes(s))
        .filter((s, i, all) => all.indexOf(s) === i);

    const experienceKey = typeof query.experience === 'string' ? query.experience.trim() : '';
    const experience = EXPERIENCE_LEVELS.some(level => level.key === experienceKey) ? experienceKey : '';

    const rawMatch = parseInt(Array.isArray(query.minMatch) ? query.minMatch[0] : query.minMatch, 10);
    const minMatch = Number.isFinite(rawMatch) ? Math.min(100, Math.max(0, rawMatch)) : 0;

    return {
        skills: parseList(query.skills),
        qualification: parseList(query.qualification),
        location: parseList(query.location),
        status,
        experience,
        minMatch
    };
}


function hasActiveFilters(filters) {
    return Boolean(
        filters.skills.length || filters.qualification.length || filters.location.length ||
        filters.status.length || filters.experience || filters.minMatch
    );
}


function applyCandidateFilters(applications = [], filters) {
    if (!filters || !hasActiveFilters(filters)) return applications.slice();

    const lower = list => list.map(v => v.toLowerCase());
    const wantedSkills = lower(filters.skills);
    const wantedQualifications = lower(filters.qualification);
    const wantedLocations = lower(filters.location);
    const minPortfolio = (EXPERIENCE_LEVELS.find(l => l.key === filters.experience) || { min: 0 }).min;

    return applications.filter(app => {
        const candidate = app && app.candidate;

        if (filters.status.length && !filters.status.includes(normalizeStatus(app.status))) return false;
        if (filters.minMatch && (Number(app.matchScore) || 0) < filters.minMatch) return false;

        const needsCandidate = wantedSkills.length || wantedQualifications.length || wantedLocations.length || minPortfolio;
        if (!needsCandidate) return true;
        
        if (!candidate) return false;

        if (wantedSkills.length) {
            const has = new Set(lower(candidateSkills(candidate)));
            if (!wantedSkills.every(skill => has.has(skill))) return false;
        }
        if (wantedQualifications.length && !wantedQualifications.includes(candidateQualification(candidate).toLowerCase())) return false;
        if (wantedLocations.length && !wantedLocations.includes(candidateLocation(candidate).toLowerCase())) return false;
        if (minPortfolio && portfolioSize(candidate) < minPortfolio) return false;

        return true;
    });
}


function countOptions(values) {
    const map = new Map();
    values.forEach(value => {
        if (!value) return;
        const key = value.toLowerCase();
        const entry = map.get(key) || { value, count: 0 };
        entry.count += 1;
        map.set(key, entry);
    });
    return [...map.values()].sort((a, b) => a.value.localeCompare(b.value, 'en', { sensitivity: 'base' }));
}


function buildCandidateFilterOptions(applications = []) {
    const candidates = applications.map(app => app && app.candidate).filter(Boolean);

    const statusCounts = {};
    applications.forEach(app => {
        const s = normalizeStatus(app && app.status);
        statusCounts[s] = (statusCounts[s] || 0) + 1;
    });

    return {
        skills: countOptions(candidates.flatMap(c => {
            
            const seen = new Set();
            return candidateSkills(c).filter(s => !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
        })),
        qualification: countOptions(candidates.map(candidateQualification)),
        location: countOptions(candidates.map(candidateLocation)),
        status: STATUS_ORDER.filter(s => statusCounts[s]).map(s => ({ value: s, count: statusCounts[s] }))
    };
}


function buildFilterQuery(filters, overrides = {}) {
    const merged = { ...filters, ...overrides };
    const params = new URLSearchParams();
    
    ['skills', 'qualification', 'location', 'status'].forEach(key => {
        (Array.isArray(merged[key]) ? merged[key] : []).forEach(value => params.append(key, value));
    });
    if (merged.experience) params.set('experience', merged.experience);
    if (merged.minMatch) params.set('minMatch', String(merged.minMatch));
    const qs = params.toString();
    return qs ? `?${qs}` : '';
}


function candidateFilterChips(filters, basePath) {
    const chips = [];
    const without = (key, value) => basePath + buildFilterQuery(filters, {
        [key]: Array.isArray(filters[key]) ? filters[key].filter(v => v !== value) : ''
    });

    filters.skills.forEach(v => chips.push({ label: `Skill: ${v}`, href: without('skills', v) }));
    filters.qualification.forEach(v => chips.push({ label: `Qualification: ${v}`, href: without('qualification', v) }));
    filters.location.forEach(v => chips.push({ label: `Location: ${v}`, href: without('location', v) }));
    if (filters.experience) {
        const level = EXPERIENCE_LEVELS.find(l => l.key === filters.experience);
        chips.push({ label: `Experience: ${level.label}`, href: without('experience') });
    }
    if (filters.minMatch) chips.push({ label: `Match: ${filters.minMatch}%+`, href: without('minMatch') });
    filters.status.forEach(v => chips.push({ label: `Status: ${v}`, href: without('status', v) }));

    return chips;
}


function buildApplicantViewLocals(applications = [], query = {}, internshipId) {
    const candidateFilters = parseCandidateFilters(query);
    const basePath = `/company/internships/${internshipId}/applicants`;

    return {
        applications: applyCandidateFilters(applications, candidateFilters),
        totalApplicants: applications.length,
        candidateFilters,
        
        
        filterOptions: buildCandidateFilterOptions(applications),
        filterChips: candidateFilterChips(candidateFilters, basePath),
        filterBasePath: basePath,
        experienceLevels: EXPERIENCE_LEVELS
    };
}

module.exports = {
    buildApplicantViewLocals,
    STATUS_ORDER,
    EXPERIENCE_LEVELS,
    MATCH_STEPS,
    parseList,
    normalizeStatus,
    candidateSkills,
    candidateLocation,
    candidateQualification,
    portfolioSize,
    parseCandidateFilters,
    hasActiveFilters,
    applyCandidateFilters,
    buildCandidateFilterOptions,
    buildFilterQuery,
    candidateFilterChips
};
