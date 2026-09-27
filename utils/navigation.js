const NAVIGATION_SECTIONS = Object.freeze({
    home: ['/'],
    opportunities: ['/internships'],
    candidateProfile: ['/candidate/profile', '/candidate/resume-builder'],
    applications: ['/candidate/applications', '/candidate/my-applications'],
    certificates: ['/candidate/certificates'],
    savedInternships: ['/candidate/saved-internships'],
    savedSearches: ['/candidate/saved-searches'],
    recommendations: ['/recommendations'],
    interview: ['/interview'],
    problems: ['/problems'],
    notifications: ['/notifications'],
    companyNotifications: ['/company/notifications'],
    companyDashboard: ['/company/dashboard', '/company/internships', '/company/applications'],
    companyProfile: ['/company/profile'],
    manageTeam: ['/company/team'],
    activityHistory: ['/company/activity'],
    adminDashboard: ['/admin']
});

function normalizePathname(pathname = '/') {
    const path = String(pathname || '/').split(/[?#]/, 1)[0] || '/';
    const withLeadingSlash = path.startsWith('/') ? path : `/${path}`;
    return withLeadingSlash === '/' ? '/' : withLeadingSlash.replace(/\/+$/, '');
}

function matchesNavigationPrefix(pathname, prefix) {
    const normalizedPath = normalizePathname(pathname);
    const normalizedPrefix = normalizePathname(prefix);

    if (normalizedPrefix === '/') return normalizedPath === '/';
    return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
}

function isNavigationActive(pathname, section) {
    const prefixes = NAVIGATION_SECTIONS[section] || [];
    return prefixes.some(prefix => matchesNavigationPrefix(pathname, prefix));
}

function buildNavigationState(pathname) {
    return Object.fromEntries(
        Object.keys(NAVIGATION_SECTIONS).map(section => [section, isNavigationActive(pathname, section)])
    );
}

module.exports = {
    NAVIGATION_SECTIONS,
    normalizePathname,
    matchesNavigationPrefix,
    isNavigationActive,
    buildNavigationState
};
