const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ejs = require('ejs');

const {
    DEFAULT_COMPLETION_RULES,
    getCompletionBadge,
    calculateProfileCompletion
} = require('../utils/profileCompletion');

test('calculateProfileCompletion: calculates 0% for empty profile', () => {
    const result = calculateProfileCompletion({});
    assert.equal(result.percentage, 0);
    assert.equal(result.isComplete, false);
    assert.equal(result.level, 'low');
    assert.equal(result.badge.label, 'Getting Started');
    assert.equal(result.missingItems.length, 6);
    assert.equal(result.completedItems.length, 0);
    assert.ok(result.nextAction);
    assert.equal(result.requiredMissingCount, 4);
    assert.equal(result.recommendedMissingCount, 2);
});

test('calculateProfileCompletion: calculates 100% when all criteria are met', () => {
    const candidate = {
        name: 'Arjun Mehta',
        email: 'arjun@example.com',
        location: { district: 'Bengaluru', state: 'Karnataka' },
        education: { qualification: 'B.Tech Computer Science', institutionName: 'IIT Delhi' },
        skills: ['JavaScript', 'Node.js', 'React'],
        skillProfiles: [
            { name: 'JavaScript', proficiency: 'Advanced' },
            { name: 'Node.js', proficiency: 'Intermediate' }
        ],
        resume: 'https://res.cloudinary.com/demo/image/upload/v1/resume.pdf',
        resumeOriginalName: 'Arjun_Mehta_Resume.pdf',
        projects: [
            { title: 'Internship Portal', description: 'Built fullstack platform', techStack: ['Node.js'] }
        ],
        certifications: [
            { name: 'AWS Certified Cloud Practitioner', issuer: 'Amazon Web Services' }
        ]
    };

    const result = calculateProfileCompletion(candidate);
    assert.equal(result.percentage, 100);
    assert.equal(result.isComplete, true);
    assert.equal(result.level, 'complete');
    assert.equal(result.badge.label, 'All-Star Profile');
    assert.equal(result.missingItems.length, 0);
    assert.equal(result.completedItems.length, 6);
    assert.equal(result.nextAction, null);
    assert.equal(result.requiredMissingCount, 0);
    assert.equal(result.recommendedMissingCount, 0);
});

test('calculateProfileCompletion: partial profile with basic details, education, skills, and resume', () => {
    // 15 (contact) + 20 (education) + 20 (skills) + 20 (resume) = 75%
    const candidate = {
        name: 'Priya Sharma',
        email: 'priya@example.com',
        location: 'Mumbai, Maharashtra',
        qualification: 'B.Com',
        institution: 'Mumbai University',
        skills: ['Financial Analysis', 'Excel'],
        resumeVersions: [
            { label: 'Finance Resume', fileName: 'priya_finance.pdf', fileUrl: '/resumes/priya.pdf' }
        ],
        projects: [],
        certifications: []
    };

    const result = calculateProfileCompletion(candidate);
    assert.equal(result.percentage, 75);
    assert.equal(result.isComplete, false);
    assert.equal(result.level, 'intermediate');
    assert.equal(result.badge.label, 'Intermediate');
    assert.equal(result.completedItems.length, 4);
    assert.equal(result.missingItems.length, 2);
    // Missing items are projects (15%) and certifications (10%)
    assert.ok(result.missingItems.some(i => i.id === 'projects'));
    assert.ok(result.missingItems.some(i => i.id === 'certifications'));
    // Next action should suggest projects because it has higher weight (15 > 10)
    assert.equal(result.nextAction.id, 'projects');
    assert.equal(result.requiredMissingCount, 0);
    assert.equal(result.recommendedMissingCount, 2);
});

test('calculateProfileCompletion: custom criteria / weight overrides', () => {
    const candidate = {
        name: 'Dev Candidate',
        email: 'dev@test.com',
        location: 'Delhi',
        skills: ['Python']
    };

    // Override weights
    const customConfig = {
        contactInfo: { weight: 50 },
        skills: { weight: 50 },
        education: { weight: 0 },
        resume: { weight: 0 },
        projects: { weight: 0 },
        certifications: { weight: 0 }
    };

    const result = calculateProfileCompletion(candidate, customConfig);
    // 50 (contactInfo) + 50 (skills) = 100% of 100 total weight
    assert.equal(result.percentage, 100);
    assert.equal(result.isComplete, true);
});

test('getCompletionBadge: returns appropriate metadata per tier', () => {
    assert.equal(getCompletionBadge(100).level, 'complete');
    assert.equal(getCompletionBadge(85).level, 'high');
    assert.equal(getCompletionBadge(60).level, 'intermediate');
    assert.equal(getCompletionBadge(35).level, 'low');
});

test('candidate-profile.ejs: renders Profile Completion Card, progress bar, badges, and checklist', () => {
    const templatePath = path.join(__dirname, '..', 'views', 'candidate', 'candidate-profile.ejs');
    const rawTemplate = fs.readFileSync(templatePath, 'utf8')
        .replace("<% layout('layouts/boilerplate') %>", '');

    const candidate = {
        name: 'Aman Verma',
        email: 'aman@example.com',
        age: 22,
        familyIncome: 350000,
        location: { district: 'Noida', state: 'Uttar Pradesh' },
        education: { qualification: 'B.Tech', institutionName: 'AKTU' },
        enrollmentStatus: 'not_enrolled',
        employmentStatus: 'unemployed',
        skills: ['React', 'CSS'],
        resume: 'https://cloudinary.com/aman.pdf',
        resumeOriginalName: 'Aman_Resume.pdf',
        projects: [],
        certifications: []
    };

    const completion = calculateProfileCompletion(candidate);

    const html = ejs.render(rawTemplate, {
        candidate,
        user: candidate,
        activeUser: candidate,
        profileCompletion: completion,
        calculateProfileCompletion,
        success_msg: null,
        error_msg: null,
        showConflictModal: false
    });

    // Check header completion pill / indicator
    assert.match(html, /id="headerCompletionBadge"/);
    assert.match(html, /id="profileCompletionCard"/);
    assert.match(html, /id="profileProgressBar"/);
    assert.match(html, /id="profileProgressPercent"/);
    assert.match(html, /Profile Completion/);
    assert.match(html, /id="profileCompletionChecklist"/);
    assert.match(html, /Projects &amp; Portfolio|Projects & Portfolio/);
});
