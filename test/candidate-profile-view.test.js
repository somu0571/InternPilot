const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const mongoose = require('mongoose');
const { sanitizeHttpUrl } = require('../utils/safeUrl');

// The recruiter "View Profile" page. A merge once dropped the lines that pass
// and read the reviewer permission, and every visit crashed with
// "canReviewApplications is not defined".

const viewPath = path.join(__dirname, '..', 'views', 'company', 'candidate-profile-view.ejs');
const template = fs.readFileSync(viewPath, 'utf8').replace("<% layout('layouts/boilerplate') %>", '');

const application = {
    _id: new mongoose.Types.ObjectId(),
    status: 'Submitted',
    appliedAt: new Date('2026-09-20T10:00:00Z'),
    matchScore: 72
};

const render = extra => ejs.render(template, {
    sanitizeHttpUrl,
    user: { role: 'recruiter' },
    application,
    candidate: {
        name: 'Asha Rao',
        skills: ['React'],
        education: { qualification: 'B.Tech' },
        projects: [],
        certifications: []
    },
    internship: { _id: new mongoose.Types.ObjectId(), title: 'Backend Intern', companyName: 'Acme' },
    skillProfiles: [{ name: 'React', proficiency: 'Advanced' }],
    ...extra
}, { filename: viewPath });

const statusForm = `action="/company/applications/${application._id}/status"`;

test('reviewers get the status dropdown and interview scheduling', () => {
    const html = render({ permissions: ['applications:view', 'applications:review'] });
    assert.ok(html.includes(statusForm));
    assert.match(html, /Schedule Interview/);
    assert.match(html, /id="scheduleInterviewModal"/);
});

test('view-only teammates see the profile without review controls', () => {
    const html = render({ permissions: ['applications:view'] });
    assert.ok(!html.includes(statusForm));
    assert.doesNotMatch(html, /id="scheduleInterviewModal"/);
    assert.match(html, /Interview scheduling is available to Admins and Recruiters/);
});

test('a render without permissions is read-only instead of crashing', () => {
    let html;
    assert.doesNotThrow(() => { html = render({}); });
    assert.ok(!html.includes(statusForm));
});

test('the profile route passes the reviewer permissions to the view', () => {
    const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'company.js'), 'utf8');
    const start = routes.indexOf("res.render('company/candidate-profile-view'");
    assert.notEqual(start, -1);
    const locals = routes.slice(start, routes.indexOf('});', start));
    assert.match(locals, /permissions:\s*req\.companyPermissions/);
});

test('reviewers get status dropdown with Interview and Hired options', () => {
    const html = render({ permissions: ['applications:view', 'applications:review'] });
    assert.ok(html.includes(statusForm));
    assert.match(html, /<option value="Interview"/);
    assert.match(html, /<option value="Hired"/);
});

test('candidates in Interview status keep an active status dropdown for reviewers', () => {
    const interviewApp = { ...application, status: 'Interview' };
    const html = render({ application: interviewApp, permissions: ['applications:view', 'applications:review'] });
    assert.ok(html.includes(`action="/company/applications/${interviewApp._id}/status"`));
    assert.match(html, /<option value="Interview"\s+selected/);
    assert.match(html, /<option value="Hired"/);
    assert.match(html, /<option value="Rejected"/);
});

test('the company status update route allows Interview and Hired', () => {
    const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'company.js'), 'utf8');
    const start = routes.indexOf("router.post('/company/applications/:id/status'");
    assert.notEqual(start, -1);
    const handler = routes.slice(start, routes.indexOf('});', start));
    assert.match(handler, /allowedStatuses\s*=\s*\[[^\]]*'Interview'[^\]]*\]/);
    assert.match(handler, /allowedStatuses\s*=\s*\[[^\]]*'Hired'[^\]]*\]/);
});
