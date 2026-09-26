const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ejs = require('ejs');

const {
    buildNavigationState,
    isNavigationActive,
    matchesNavigationPrefix,
    normalizePathname
} = require('../utils/navigation');

const headerPath = path.join(__dirname, '..', 'views', 'partials', 'header.ejs');
const headerTemplate = fs.readFileSync(headerPath, 'utf8');

function renderHeader(currentPath, currentUser = null) {
    return ejs.render(headerTemplate, {
        currentPath,
        currentUser,
        navigation: buildNavigationState(currentPath),
        notificationUnreadCount: 0
    }, { filename: headerPath });
}

function activeLinkCount(html, href) {
    const escapedHref = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return (html.match(new RegExp(`href="${escapedHref}"[^>]*aria-current="page"`, 'g')) || []).length;
}

test('navigation path matching is exact for Home and includes nested child routes', () => {
    assert.equal(normalizePathname('/internships/?query=value'), '/internships');
    assert.equal(matchesNavigationPrefix('/', '/'), true);
    assert.equal(matchesNavigationPrefix('/internships', '/'), false);
    assert.equal(isNavigationActive('/internships/507f1f77bcf86cd799439011', 'opportunities'), true);
    assert.equal(isNavigationActive('/candidate/profile/edit', 'candidateProfile'), true);
    assert.equal(isNavigationActive('/company/internships/507f1f77bcf86cd799439011/applicants', 'companyDashboard'), true);
    assert.equal(isNavigationActive('/company/team', 'companyDashboard'), false);
    assert.equal(isNavigationActive('/company/team', 'manageTeam'), true);
    assert.equal(isNavigationActive('/company/profile', 'companyProfile'), true);
    assert.equal(isNavigationActive('/company/notifications', 'companyNotifications'), true);
});

test('header marks nested Opportunities links active on both desktop and mobile', () => {
    const html = renderHeader('/internships/507f1f77bcf86cd799439011');

    assert.equal(activeLinkCount(html, '/internships'), 2);
    assert.equal(activeLinkCount(html, '/'), 0);
    assert.match(html, /border-indigo-700/);
    assert.match(html, /font-bold/);
});

test('header marks the candidate application page active and keeps its mobile counterpart', () => {
    const candidate = { _id: 'candidate-id', name: 'Candidate', role: 'candidate' };
    const html = renderHeader('/candidate/applications', candidate);

    assert.equal(activeLinkCount(html, '/candidate/applications'), 2);
    assert.match(html, /id="mobileNavToggle"/);
    assert.match(html, /aria-controls="mobileNavigation"/);
    assert.match(html, /id="mobileNavigation"/);
    assert.match(html, /data-nav-variant="mobile"/);
});

test('company routes keep dashboard, profile, team, and notifications distinct', () => {
    const company = { _id: 'company-id', name: 'Admin', role: 'company' };
    const dashboardHtml = renderHeader('/company/internships/507f1f77bcf86cd799439011/applicants', company);
    const teamHtml = renderHeader('/company/team', company);
    const profileHtml = renderHeader('/company/profile', company);
    const notificationsHtml = renderHeader('/company/notifications', company);

    assert.equal(activeLinkCount(dashboardHtml, '/company/dashboard'), 2);
    assert.equal(activeLinkCount(dashboardHtml, '/company/team'), 0);
    assert.equal(activeLinkCount(teamHtml, '/company/dashboard'), 0);
    assert.equal(activeLinkCount(teamHtml, '/company/team'), 2);
    assert.equal(activeLinkCount(profileHtml, '/company/profile'), 2);
    assert.equal(activeLinkCount(notificationsHtml, '/company/notifications'), 2);
});

test('header synchronizes history-based navigation and supports keyboard dismissal of the mobile menu', () => {
    assert.match(headerTemplate, /\['pushState', 'replaceState'\]/);
    assert.match(headerTemplate, /window\.addEventListener\('popstate', syncActiveNavigation\)/);
    assert.match(headerTemplate, /event\.key === 'Escape'/);
    assert.match(headerTemplate, /aria-current/);
});

test('header includes circular brand logo mark with proper hierarchy, styling and alt text', () => {
    const html = renderHeader('/');
    
    assert.match(html, /src="\/images\/internpilot-logo\.svg"/);
    assert.match(html, /alt="InternPilot Logo"/);
    assert.match(html, /header-brand-logo/);
    assert.match(html, /object-contain/);

    const emblemIdx = html.indexOf('/images/emblem.jpg');
    const logoIdx = html.indexOf('/images/internpilot-logo.svg');
    const textIdx = html.indexOf('Intern</span>Pilot');
    const pmisIdx = html.indexOf('>PMIS<');

    assert.ok(emblemIdx !== -1, 'Emblem exists');
    assert.ok(logoIdx !== -1, 'Logo mark exists');
    assert.ok(textIdx !== -1, 'InternPilot text exists');
    assert.ok(pmisIdx !== -1, 'PMIS badge exists');

    assert.ok(emblemIdx < logoIdx, 'Emblem is before Logo mark');
    assert.ok(logoIdx < textIdx, 'Logo mark is before InternPilot text');
    assert.ok(textIdx < pmisIdx, 'InternPilot text is before PMIS badge');
});

