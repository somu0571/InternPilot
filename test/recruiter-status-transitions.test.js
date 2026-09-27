const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const mongoose = require('mongoose');
const { sanitizeHttpUrl } = require('../utils/safeUrl');

const companyApplicantsPath = path.join(__dirname, '..', 'views', 'company', 'company-applicants.ejs');
const companyApplicantsTemplate = fs.readFileSync(companyApplicantsPath, 'utf8')
    .replace("<% layout('layouts/boilerplate') %>", '');

const recruiterListPath = path.join(__dirname, '..', 'views', 'recruiter', 'applicant-list.ejs');
const recruiterListTemplate = fs.readFileSync(recruiterListPath, 'utf8')
    .replace("<% layout('layouts/boilerplate') %>", '');

const myAppsPath = path.join(__dirname, '..', 'views', 'candidate', 'my-applications.ejs');
const myAppsTemplate = fs.readFileSync(myAppsPath, 'utf8')
    .replace("<% layout('layouts/boilerplate') %>", '');

const baseInternship = {
    _id: new mongoose.Types.ObjectId(),
    title: 'Full Stack Intern',
    companyName: 'TechCorp',
    vacancies: 2
};

const interviewApp = {
    _id: new mongoose.Types.ObjectId(),
    status: 'Interview',
    appliedAt: new Date('2026-09-20T10:00:00Z'),
    matchScore: 88,
    candidate: {
        _id: new mongoose.Types.ObjectId(),
        name: 'Devika Sharma',
        skills: ['JavaScript', 'React'],
        education: { qualification: 'B.Tech' },
        location: { district: 'Bengaluru', state: 'Karnataka' },
        resume: '/uploads/resumes/dummy.pdf'
    },
    interview: {
        status: 'Scheduled',
        scheduledAt: new Date('2026-09-30T10:00:00Z'),
        mode: 'Online'
    }
};

const hiredApp = {
    _id: new mongoose.Types.ObjectId(),
    status: 'Hired',
    appliedAt: new Date('2026-09-18T10:00:00Z'),
    matchScore: 95,
    candidate: {
        _id: new mongoose.Types.ObjectId(),
        name: 'Amit Kumar',
        skills: ['Python', 'Django'],
        education: { qualification: 'MCA' },
        location: { district: 'Delhi', state: 'Delhi' }
    }
};

test('company-applicants.ejs allows reviewers to update status for Interview candidates', () => {
    const html = ejs.render(companyApplicantsTemplate, {
        sanitizeHttpUrl,
        user: { role: 'recruiter' },
        internship: baseInternship,
        applications: [interviewApp],
        permissions: ['applications:view', 'applications:review']
    }, { filename: companyApplicantsPath });

    // Reviewer should have a form targeting the status update route
    assert.ok(html.includes(`action="/company/applications/${interviewApp._id}/status"`), 'Must render status update form');
    // The dropdown should have Interview selected
    assert.match(html, /<option value="Interview"\s+selected/, 'Interview should be selected in the dropdown');
    // Dropdown should contain options to advance to Hired or Rejected
    assert.match(html, /<option value="Hired"/, 'Should include Hired option');
    assert.match(html, /<option value="Rejected"/, 'Should include Rejected option');
});

test('company-applicants.ejs shows read-only badge for view-only users', () => {
    const html = ejs.render(companyApplicantsTemplate, {
        sanitizeHttpUrl,
        user: { role: 'recruiter' },
        internship: baseInternship,
        applications: [interviewApp],
        permissions: ['applications:view']
    }, { filename: companyApplicantsPath });

    assert.ok(!html.includes(`action="/company/applications/${interviewApp._id}/status"`), 'Must not render status update form for view-only users');
    assert.match(html, /Interview/, 'Should display current status text');
});

test('recruiter applicant-list.ejs includes Interview and Hired options', () => {
    const html = ejs.render(recruiterListTemplate, {
        internship: baseInternship,
        applications: [interviewApp, hiredApp],
        user: { role: 'recruiter' }
    }, { filename: recruiterListPath });

    assert.match(html, /<option value="Interview"/);
    assert.match(html, /<option value="Hired"/);
    assert.match(html, /Hired/);
});

test('my-applications.ejs counts Interview applications in active applications', () => {
    const html = ejs.render(myAppsTemplate, {
        applications: [interviewApp, hiredApp],
        user: { role: 'candidate' },
        candidate: { name: 'Candidate' },
        formatRelativeTime: () => '2 days ago',
        formatLocalizedDateTime: () => '24 Sept 2026, 5:30 pm'
    }, { filename: myAppsPath });

    // Active / Under Review card should count the Interview application (1 active)
    assert.match(html, /Active \/ Under Review/);
    assert.match(html, /<div class="text-2xl font-bold text-emerald-700 mt-1">1<\/div>/);
});
