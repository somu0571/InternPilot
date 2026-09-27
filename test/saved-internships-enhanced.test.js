const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const { formatDeadlineUrgency } = require('../utils/dateFormat');
const candidateRouter = require('../routes/candidate');
const User = require('../models/User');
const Application = require('../models/Application');

const savedInternshipsViewPath = path.join(__dirname, '..', 'views', 'candidate', 'saved-internships.ejs');
const savedInternshipsTemplate = fs.readFileSync(savedInternshipsViewPath, 'utf8');

// Helper to look up express route layers
function routeLayer(router, routePath, method) {
    return router.stack.find(layer =>
        layer.route && layer.route.path === routePath && layer.route.methods[method]
    );
}

function routeHandler(router, routePath, method) {
    const layer = routeLayer(router, routePath, method);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}

// -------------------------------------------------------------
// 1. formatDeadlineUrgency Unit Tests
// -------------------------------------------------------------

test('formatDeadlineUrgency returns null for null, undefined, or invalid dates', () => {
    assert.equal(formatDeadlineUrgency(null), null);
    assert.equal(formatDeadlineUrgency(undefined), null);
    assert.equal(formatDeadlineUrgency(''), null);
    assert.equal(formatDeadlineUrgency('not-a-valid-date'), null);
});

test('formatDeadlineUrgency marks past or immediate deadlines as closed', () => {
    const now = new Date('2026-10-10T12:00:00.000Z');
    const past = new Date('2026-10-09T12:00:00.000Z');
    const result = formatDeadlineUrgency(past, now);

    assert.ok(result);
    assert.equal(result.label, 'Application Closed');
    assert.equal(result.urgency, 'closed');
    assert.equal(result.isClosed, true);
    assert.equal(result.daysLeft, 0);
    assert.match(result.badgeClass, /rose/);
    assert.equal(result.icon, 'ph-bold ph-x-circle');
});

test('formatDeadlineUrgency marks deadline within 1 day as critical', () => {
    const now = new Date('2026-10-10T12:00:00.000Z');
    const in12Hours = new Date('2026-10-11T00:00:00.000Z');
    const result = formatDeadlineUrgency(in12Hours, now);

    assert.ok(result);
    assert.equal(result.label, 'Closing in 1 day');
    assert.equal(result.urgency, 'critical');
    assert.equal(result.isClosed, false);
    assert.equal(result.daysLeft, 1);
    assert.match(result.badgeClass, /rose/);
    assert.equal(result.icon, 'ph-bold ph-warning');
});

test('formatDeadlineUrgency marks deadline in 2-3 days as warning', () => {
    const now = new Date('2026-10-10T12:00:00.000Z');
    const in2Days = new Date('2026-10-12T12:00:00.000Z');
    const result2 = formatDeadlineUrgency(in2Days, now);

    assert.ok(result2);
    assert.equal(result2.label, 'Closing in 2 days');
    assert.equal(result2.urgency, 'warning');
    assert.equal(result2.isClosed, false);
    assert.equal(result2.daysLeft, 2);
    assert.match(result2.badgeClass, /amber/);
    assert.equal(result2.icon, 'ph-bold ph-hourglass-medium');

    const in3Days = new Date('2026-10-13T12:00:00.000Z');
    const result3 = formatDeadlineUrgency(in3Days, now);
    assert.equal(result3.label, 'Closing in 3 days');
    assert.equal(result3.urgency, 'warning');
});

test('formatDeadlineUrgency marks deadline in 4-7 days as soon', () => {
    const now = new Date('2026-10-10T12:00:00.000Z');
    const in5Days = new Date('2026-10-15T12:00:00.000Z');
    const result = formatDeadlineUrgency(in5Days, now);

    assert.ok(result);
    assert.equal(result.label, 'Closing in 5 days');
    assert.equal(result.urgency, 'soon');
    assert.equal(result.isClosed, false);
    assert.equal(result.daysLeft, 5);
    assert.match(result.badgeClass, /amber/);
    assert.equal(result.icon, 'ph-bold ph-clock');
});

test('formatDeadlineUrgency marks deadline beyond 7 days as normal', () => {
    const now = new Date('2026-10-10T12:00:00.000Z');
    const in14Days = new Date('2026-10-24T12:00:00.000Z');
    const result = formatDeadlineUrgency(in14Days, now);

    assert.ok(result);
    assert.equal(result.label, '14 days left');
    assert.equal(result.urgency, 'normal');
    assert.equal(result.isClosed, false);
    assert.equal(result.daysLeft, 14);
    assert.match(result.badgeClass, /emerald/);
    assert.equal(result.icon, 'ph-bold ph-calendar-check');
});

// -------------------------------------------------------------
// 2. View Rendering Tests
// -------------------------------------------------------------

test('saved-internships view renders an empty state when candidate has no bookmarks', () => {
    const html = ejs.render(savedInternshipsTemplate, {
        layout: () => undefined,
        currentUser: { _id: 'candidate-1', role: 'candidate' },
        internships: [],
        sectors: [],
        formatDeadlineUrgency
    }, { filename: savedInternshipsViewPath });

    assert.match(html, /No Saved Internships/);
    assert.match(html, /Browse Opportunities/);
    assert.match(html, /id="noSavedState"/);
});

test('saved-internships view renders search, sector filters, deadline badges, and applied indicators', () => {
    const now = new Date('2026-10-10T12:00:00.000Z');
    const dummyInternships = [
        {
            _id: 'internship-101',
            title: 'Full Stack Engineer Intern',
            companyName: 'Tech Innovators',
            companyId: { _id: 'comp-1', companyName: 'Tech Innovators' },
            sector: 'Technology',
            location: { district: 'Bengaluru', state: 'Karnataka' },
            monthlyStipend: 25000,
            duration: '6 Months',
            applicationDeadline: new Date('2026-10-12T12:00:00.000Z'),
            deadlineInfo: formatDeadlineUrgency(new Date('2026-10-12T12:00:00.000Z'), now),
            hasApplied: false,
            createdAt: new Date('2026-10-01T00:00:00.000Z')
        },
        {
            _id: 'internship-102',
            title: 'Data Analyst Intern',
            companyName: 'FinCorp Analytics',
            companyId: { _id: 'comp-2', companyName: 'FinCorp Analytics' },
            sector: 'Finance',
            location: { district: 'Mumbai', state: 'Maharashtra' },
            monthlyStipend: 18000,
            duration: '3 Months',
            applicationDeadline: new Date('2026-10-08T12:00:00.000Z'),
            deadlineInfo: formatDeadlineUrgency(new Date('2026-10-08T12:00:00.000Z'), now),
            hasApplied: true,
            applicationStatus: 'Under Review',
            createdAt: new Date('2026-09-25T00:00:00.000Z')
        }
    ];

    const html = ejs.render(savedInternshipsTemplate, {
        layout: () => undefined,
        currentUser: { _id: 'candidate-1', role: 'candidate' },
        internships: dummyInternships,
        sectors: ['Finance', 'Technology'],
        formatDeadlineUrgency
    }, { filename: savedInternshipsViewPath });

    // Search bar and toolbar
    assert.match(html, /id="savedSearchInput"/);
    assert.match(html, /placeholder="Search by role title or company\.\.\."/);
    assert.match(html, /id="sectorFilter"/);
    assert.match(html, /id="statusFilter"/);
    assert.match(html, /<option value="Technology">/);
    assert.match(html, /<option value="Finance">/);

    // Cards data attributes for client filtering
    assert.match(html, /data-id="internship-101"/);
    assert.match(html, /data-title="full stack engineer intern"/);
    assert.match(html, /data-company="tech innovators"/);
    assert.match(html, /data-sector="Technology"/);
    assert.match(html, /data-applied="false"/);

    // Deadline badge: Closing in 2 days
    assert.match(html, /Closing in 2 days/);
    assert.match(html, /ph-hourglass-medium/);

    // Second card: Applied badge and Application Closed
    assert.match(html, /data-id="internship-102"/);
    assert.match(html, /data-applied="true"/);
    assert.match(html, /applied-badge/);
    assert.match(html, /Applied/);
    assert.match(html, /Application Closed/);

    // Single-click remove button
    assert.match(html, /class="[^"]*bookmark-btn/);
    assert.match(html, /title="Remove from saved"/);
    assert.match(html, /aria-label="Remove from saved"/);

    // Filter empty state exists
    assert.match(html, /id="filterEmptyState"/);
    assert.match(html, /No matching saved internships/);
});

// -------------------------------------------------------------
// 3. Route Tests
// -------------------------------------------------------------

test('candidate route GET /candidate/saved-internships is registered with auth and role middleware', () => {
    const layer = routeLayer(candidateRouter, '/candidate/saved-internships', 'get');
    assert.ok(layer, 'GET /candidate/saved-internships is registered');
    assert.ok(layer.route.stack.length >= 3, 'Route contains isAuthenticated, authorize, and handler');
    assert.equal(layer.route.stack[0].handle.name, 'isAuthenticated');
});

test('candidate route GET /candidate/saved-internships enriches internships with applied status and sectors', async () => {
    const handler = routeHandler(candidateRouter, '/candidate/saved-internships', 'get');

    const fakeUser = {
        _id: 'candidate-99',
        savedInternships: [
            {
                _id: 'internship-aaa',
                title: 'Backend Developer Intern',
                companyName: 'CloudScale',
                sector: 'Technology',
                applicationDeadline: new Date(Date.now() + 86400000 * 2)
            },
            {
                _id: 'internship-bbb',
                title: 'Marketing Intern',
                companyName: 'GrowthX',
                sector: 'Marketing',
                applicationDeadline: new Date(Date.now() - 86400000)
            }
        ]
    };

    const originalFindById = User.findById;
    const originalAppFind = Application.find;

    User.findById = (id) => ({
        populate: () => ({
            lean: async () => fakeUser
        })
    });

    Application.find = (query) => ({
        select: () => ({
            lean: async () => [
                {
                    internship: 'internship-aaa',
                    status: 'Submitted',
                    appliedAt: new Date()
                }
            ]
        })
    });

    try {
        let renderedView = null;
        let renderedData = null;

        const req = {
            user: { _id: 'candidate-99', role: 'candidate' },
            query: {}
        };
        const res = {
            render: (view, data) => {
                renderedView = view;
                renderedData = data;
            },
            redirect: () => {}
        };

        await handler(req, res);

        assert.equal(renderedView, 'candidate/saved-internships');
        assert.ok(renderedData);
        assert.equal(renderedData.internships.length, 2);

        // Check internship-aaa enrichment
        const itemA = renderedData.internships.find(i => i._id === 'internship-aaa');
        assert.ok(itemA);
        assert.equal(itemA.hasApplied, true);
        assert.equal(itemA.applicationStatus, 'Submitted');
        assert.ok(itemA.deadlineInfo);
        assert.equal(itemA.deadlineInfo.urgency, 'warning');

        // Check internship-bbb enrichment
        const itemB = renderedData.internships.find(i => i._id === 'internship-bbb');
        assert.ok(itemB);
        assert.equal(itemB.hasApplied, false);
        assert.equal(itemB.applicationStatus, null);
        assert.ok(itemB.deadlineInfo);
        assert.equal(itemB.deadlineInfo.isClosed, true);

        // Check sectors extraction
        assert.deepEqual(renderedData.sectors, ['Marketing', 'Technology']);
    } finally {
        User.findById = originalFindById;
        Application.find = originalAppFind;
    }
});
