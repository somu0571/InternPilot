const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ejs = require('ejs');
const mongoose = require('mongoose');
const {
    companyDashboardStatusQuery,
    normalizeDashboardSort,
    normalizeDashboardStatus,
    sortCompanyDashboardInternships
} = require('../utils/companyDashboardFilters');

test('company-dashboard.ejs renders sort control and matching options', () => {
    const templatePath = path.join(__dirname, '..', 'views', 'company', 'company-dashboard.ejs');
    const templateContent = fs.readFileSync(templatePath, 'utf8')
        .replace("<% layout('layouts/boilerplate') %>", "");

    const recruiterId = new mongoose.Types.ObjectId();
    const id1 = new mongoose.Types.ObjectId();
    const id2 = new mongoose.Types.ObjectId();

    const html = ejs.render(templateContent, {
        user: { _id: recruiterId, role: 'recruiter', companyId: recruiterId },
        internships: [
            {
                _id: id1,
                title: 'Frontend Intern',
                status: 'published',
                isPaused: false,
                companyId: recruiterId,
                monthlyStipend: 15000,
                vacancies: 2,
                duration: '3 Months',
                location: { district: 'Noida', state: 'UP' },
                requiredSkills: ['React', 'CSS'],
                applicationDeadline: new Date(Date.now() + 86400000 * 5)
            },
            {
                _id: id2,
                title: 'Backend Intern',
                status: 'draft',
                isPaused: false,
                companyId: recruiterId,
                monthlyStipend: 20000,
                vacancies: 1,
                duration: '6 Months',
                location: { district: 'Delhi', state: 'Delhi' },
                requiredSkills: ['Node.js'],
                applicationDeadline: null
            }
        ],
        totalApplicationsCount: 12,
        activeCount: 1,
        closedCount: 0,
        publishedCount: 1,
        pausedCount: 0,
        draftCount: 1,
        expiredCount: 0,
        totalCount: 2,
        currentFilter: 'all',
        currentSort: 'most_applications',
        currentPage: 1,
        pageCount: 2,
        previousPageUrl: null,
        nextPageUrl: '/company/dashboard?status=all&sort=most_applications&page=2',
        appCountMap: {
            [id1.toString()]: 10,
            [id2.toString()]: 2
        }
    });

    assert(html.includes('id="sortInternships"'), 'Must contain sortInternships select element');
    assert(html.includes('value="newest"'), 'Must have Newest sort option');
    assert(html.includes('value="oldest"'), 'Must have Oldest sort option');
    assert(html.includes('value="title"'), 'Must have Title sort option');
    assert(html.includes('value="most_applications"'), 'Must have Most Applications sort option');
    assert(html.includes('value="deadline"'), 'Must have Application Deadline sort option');
    assert(html.includes('data-id='), 'Internship cards must have data-id attribute');
    assert(html.includes('data-posted='), 'Internship cards must have data-posted attribute');
    assert(html.includes('data-applications="10"'), 'Internship cards must have data-applications attribute');
    assert(html.includes('data-deadline='), 'Internship cards must have data-deadline attribute');
    assert(html.includes('&amp;sort=most_applications') || html.includes('&sort=most_applications'), 'Filter tabs must preserve current sort parameter');
    assert(html.includes('data-status="active"'), 'Must render an Active filter');
    assert(html.includes('data-status="closed"'), 'Must render a Closed filter');
    assert(html.includes('data-status="draft"'), 'Must render a Draft filter');
    assert(html.includes('data-status="expired"'), 'Must render an Expired filter');
    assert(html.includes('href="/company/dashboard?status=all&amp;sort=most_applications&amp;page=2"'), 'Pagination must preserve the current filter and sort');
});

test('dashboard filters normalize aliases and build deadline-aware lifecycle queries', () => {
    const now = new Date('2026-09-27T12:00:00.000Z');

    assert.equal(normalizeDashboardStatus('published'), 'active');
    assert.equal(normalizeDashboardStatus('paused'), 'closed');
    assert.equal(normalizeDashboardStatus('unknown'), 'all');
    assert.equal(normalizeDashboardSort('applications_desc'), 'most_applications');
    assert.equal(normalizeDashboardSort('title'), 'title');
    assert.equal(normalizeDashboardSort('unknown'), 'newest');

    const activeQuery = companyDashboardStatusQuery('active', now);
    assert.deepEqual(activeQuery.status, { $in: ['published', null] });
    assert.deepEqual(activeQuery.isPaused, { $ne: true });
    assert.deepEqual(activeQuery.$or[2], { applicationDeadline: { $gte: now } });
    assert.deepEqual(companyDashboardStatusQuery('draft', now), { status: 'draft' });
    assert.deepEqual(companyDashboardStatusQuery('expired', now), {
        status: { $nin: ['draft', 'closed'] },
        applicationDeadline: { $lt: now }
    });
    assert.deepEqual(companyDashboardStatusQuery('all', now), {});
});

test('sort algorithm orders properly by newest and oldest with _id tie-breaker', () => {
    
    const oldId = new mongoose.Types.ObjectId(Math.floor(Date.now() / 1000 - 1000).toString(16) + '0000000000000000');
    const newId = new mongoose.Types.ObjectId(Math.floor(Date.now() / 1000).toString(16) + '0000000000000000');

    const itemOld = { _id: oldId, title: 'Old Role' };
    const itemNew = { _id: newId, title: 'New Role' };

    const sortedNewest = sortCompanyDashboardInternships([itemOld, itemNew], 'newest');
    assert.equal(sortedNewest[0]._id, newId);
    assert.equal(sortedNewest[1]._id, oldId);

    const sortedOldest = sortCompanyDashboardInternships([itemOld, itemNew], 'oldest');
    assert.equal(sortedOldest[0]._id, oldId);
    assert.equal(sortedOldest[1]._id, newId);

    
    const fixedTime = Math.floor(Date.now() / 1000).toString(16);
    const tieId1 = new mongoose.Types.ObjectId(fixedTime + '0000000000000001');
    const tieId2 = new mongoose.Types.ObjectId(fixedTime + '0000000000000002');

    const itemTie1 = { _id: tieId1, title: 'Tie Role 1' };
    const itemTie2 = { _id: tieId2, title: 'Tie Role 2' };

    const sortedTieOldest = sortCompanyDashboardInternships([itemTie2, itemTie1], 'oldest');
    assert.equal(sortedTieOldest[0]._id, tieId1);
    assert.equal(sortedTieOldest[1]._id, tieId2);

    const sortedTieNewest = sortCompanyDashboardInternships([itemTie1, itemTie2], 'newest');
    assert.equal(sortedTieNewest[0]._id, tieId2);
    assert.equal(sortedTieNewest[1]._id, tieId1);
});

test('sort algorithm orders properly by most applications', () => {
    const idA = new mongoose.Types.ObjectId();
    const idB = new mongoose.Types.ObjectId();
    const idC = new mongoose.Types.ObjectId();

    const itemA = { _id: idA, title: 'Role A' };
    const itemB = { _id: idB, title: 'Role B' };
    const itemC = { _id: idC, title: 'Role C' };

    const appCountMap = {
        [idA.toString()]: 5,
        [idB.toString()]: 25,
        [idC.toString()]: 12
    };

    const sorted = sortCompanyDashboardInternships([itemA, itemB, itemC], 'most_applications', appCountMap);
    assert.equal(sorted[0]._id, idB); 
    assert.equal(sorted[1]._id, idC); 
    assert.equal(sorted[2]._id, idA); 
});

test('sort algorithm orders titles alphabetically without case sensitivity', () => {
    const idA = new mongoose.Types.ObjectId();
    const idB = new mongoose.Types.ObjectId();
    const internships = [
        { _id: idA, title: 'zebra role' },
        { _id: idB, title: 'Alpha role' }
    ];

    const sorted = sortCompanyDashboardInternships(internships, 'title');
    assert.equal(sorted[0]._id, idB);
    assert.equal(sorted[1]._id, idA);
});

test('sort algorithm orders properly by deadline (soonest first, no deadline last)', () => {
    const now = Date.now();
    const idSoon = new mongoose.Types.ObjectId();
    const idLater = new mongoose.Types.ObjectId();
    const idNoDeadline = new mongoose.Types.ObjectId();

    const itemSoon = { _id: idSoon, applicationDeadline: new Date(now + 86400000 * 2) };
    const itemLater = { _id: idLater, applicationDeadline: new Date(now + 86400000 * 10) };
    const itemNoDeadline = { _id: idNoDeadline, applicationDeadline: null };

    const sorted = sortCompanyDashboardInternships([itemLater, itemNoDeadline, itemSoon], 'deadline');
    assert.equal(sorted[0]._id, idSoon);
    assert.equal(sorted[1]._id, idLater);
    assert.equal(sorted[2]._id, idNoDeadline);
});
