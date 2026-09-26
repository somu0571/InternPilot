const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const mongoose = require('mongoose');
const { calculateCandidateMatch } = require('../utils/candidateMatcher');

test('candidate matcher ranks skill, qualification, and location alignment', () => {
    const internship = {
        requiredSkills: ['Node.js', 'React'],
        minQualifications: 'B.Tech',
        location: { district: 'Noida', state: 'UP' }
    };

    const strongMatch = calculateCandidateMatch({
        skills: ['node.js', 'React'],
        skillProfiles: [
            { name: 'node.js', proficiency: 'Advanced' },
            { name: 'React', proficiency: 'Advanced' }
        ],
        education: { qualification: 'B.Tech Computer Science' },
        location: { district: 'Noida', state: 'UP' }
    }, internship);
    const weakMatch = calculateCandidateMatch({
        skills: ['Python'],
        education: { qualification: 'MCA' },
        location: { district: 'Pune', state: 'MH' }
    }, internship);

    assert.equal(strongMatch.score, 100);
    assert.ok(strongMatch.score > weakMatch.score);
    assert.deepEqual(strongMatch.matchingSkills, ['node.js', 'react']);
    assert.deepEqual(strongMatch.matchingSkillProfiles.map(match => match.proficiency), ['Advanced', 'Advanced']);
    assert.match(strongMatch.rationale, /Matching skills: node\.js, react/);
    assert.match(strongMatch.rationale, /Proficiency: Advanced node\.js, Advanced React/);
    assert.match(strongMatch.rationale, /Qualification aligns/);
});

test('company applicants view renders top match and rationale', () => {
    const templatePath = path.join(__dirname, '..', 'views', 'company', 'company-applicants.ejs');
    const template = fs.readFileSync(templatePath, 'utf8').replace("<% layout('layouts/boilerplate') %>", '');
    const application = {
        _id: new mongoose.Types.ObjectId(),
        status: 'Submitted',
        appliedAt: new Date(),
        matchScore: 92,
        matchRationale: 'Matching skills: node.js. Qualification aligns.',
        candidate: {
            name: 'Asha Rao',
            education: { qualification: 'B.Tech' },
            location: { district: 'Noida', state: 'UP' },
            skills: ['Node.js'],
            skillProfiles: [{ name: 'Node.js', proficiency: 'Advanced' }]
        },
        candidateSkillProfiles: [{ name: 'Node.js', proficiency: 'Advanced' }],
        notes: []
    };

    const html = ejs.render(template, {
        internship: { title: 'Backend Intern', vacancies: 1, companyName: 'Acme' },
        applications: [application],
        user: { _id: new mongoose.Types.ObjectId(), role: 'recruiter' }
    });

    assert.match(html, /Top Match #1/);
    assert.match(html, /Matching skills: node\.js/);
    assert.match(html, /Advanced/);
    assert.match(html, /proficiencyFilter/);
    assert.match(template, /const matchesSearch = !searchTerm \|\| cardData\.includes\(searchTerm\)/);
    assert.doesNotMatch(template, /queryMatchesSkill/);
});

test('company applicants card collapses skills over 4 into an expandable chip', () => {
    const templatePath = path.join(__dirname, '..', 'views', 'company', 'company-applicants.ejs');
    const template = fs.readFileSync(templatePath, 'utf8').replace("<% layout('layouts/boilerplate') %>", '');
    const appId = new mongoose.Types.ObjectId();
    const skills = ['JavaScript', 'React', 'Python', 'Java', 'C++', 'SQL', 'MongoDB', 'Git'];
    const application = {
        _id: appId,
        status: 'Submitted',
        appliedAt: new Date(),
        matchScore: 80,
        candidate: {
            name: 'Test Candidate',
            skills
        },
        candidateSkillProfiles: skills.map(name => ({ name, proficiency: 'Intermediate' })),
        notes: []
    };

    const html = ejs.render(template, {
        internship: { title: 'Engineer', vacancies: 1, companyName: 'Acme', requiredSkills: skills },
        applications: [application],
        user: { _id: new mongoose.Types.ObjectId(), role: 'recruiter' }
    });

    assert.match(html, /\+4 more/);
    assert.match(html, new RegExp(`id="extra-skills-${appId}"`));
    assert.match(html, /class="hidden inline-flex flex-wrap items-center gap-1\.5"/);
});

test('company applicants card renders graceful metadata fallback without orphan icons or double bullets', () => {
    const templatePath = path.join(__dirname, '..', 'views', 'company', 'company-applicants.ejs');
    const template = fs.readFileSync(templatePath, 'utf8').replace("<% layout('layouts/boilerplate') %>", '');

    // Case 1: Incomplete profile (missing location district and state, but has qualification and age)
    const incompleteApp = {
        _id: new mongoose.Types.ObjectId(),
        status: 'Submitted',
        appliedAt: new Date(),
        candidate: {
            name: 'Incomplete Candidate',
            education: { qualification: 'B.Tech' },
            location: { district: '', state: '' },
            age: 24,
            skills: ['JavaScript']
        },
        candidateSkillProfiles: [{ name: 'JavaScript', proficiency: 'Intermediate' }],
        notes: []
    };

    const html = ejs.render(template, {
        internship: { title: 'Engineer', vacancies: 1, companyName: 'Acme' },
        applications: [incompleteApp],
        user: { _id: new mongoose.Types.ObjectId(), role: 'recruiter' }
    });

    // Should NOT have hanging map-pin icon
    assert.doesNotMatch(html, /ph-map-pin/);
    // Should NOT have double separator dots
    assert.doesNotMatch(html, /&bull;(?:\s*<[^>]+>\s*)*&bull;/);
    // Should render qualification and age
    assert.match(html, /B\.Tech/);
    assert.match(html, /Age: 24/);
});

test('company applicants card renders collapsible notes section hidden by default with note count', () => {
    const templatePath = path.join(__dirname, '..', 'views', 'company', 'company-applicants.ejs');
    const template = fs.readFileSync(templatePath, 'utf8').replace("<% layout('layouts/boilerplate') %>", '');
    const appId = new mongoose.Types.ObjectId();
    const application = {
        _id: appId,
        status: 'Submitted',
        appliedAt: new Date(),
        candidate: {
            name: 'Notes Candidate',
            skills: ['JavaScript']
        },
        candidateSkillProfiles: [{ name: 'JavaScript', proficiency: 'Intermediate' }],
        notes: [
            { _id: new mongoose.Types.ObjectId(), text: 'Solid candidate.', createdAt: new Date() }
        ]
    };

    const html = ejs.render(template, {
        internship: { title: 'Engineer', vacancies: 1, companyName: 'Acme' },
        applications: [application],
        user: { _id: new mongoose.Types.ObjectId(), role: 'recruiter' }
    });

    assert.match(html, /Candidate Notes \(1\)/);
    assert.match(html, new RegExp(`id="notes-section-${appId}" class="hidden`));
    assert.match(html, /Solid candidate\./);
});

test('company applicants card renders only skills matching recruiter requirements', () => {
    const templatePath = path.join(__dirname, '..', 'views', 'company', 'company-applicants.ejs');
    const template = fs.readFileSync(templatePath, 'utf8').replace("<% layout('layouts/boilerplate') %>", '');
    const appId = new mongoose.Types.ObjectId();
    const candidateSkills = [
        { name: 'JavaScript', proficiency: 'Intermediate' },
        { name: 'Node.js', proficiency: 'Intermediate' },
        { name: 'Python', proficiency: 'Beginner' },
        { name: 'Ruby', proficiency: 'Advanced' }
    ];
    const application = {
        _id: appId,
        status: 'Under Review',
        appliedAt: new Date(),
        matchScore: 85,
        matchRationale: 'Matching skills: JavaScript, Node.js.',
        candidate: {
            name: 'Target Candidate',
            skills: candidateSkills.map(s => s.name)
        },
        candidateSkillProfiles: candidateSkills,
        notes: []
    };

    const html = ejs.render(template, {
        internship: {
            title: 'Fullstack Intern',
            vacancies: 1,
            companyName: 'Acme',
            requiredSkills: ['JavaScript', 'Node.js'],
            minQualifications: 'B.Tech'
        },
        applications: [application],
        user: { _id: new mongoose.Types.ObjectId(), role: 'recruiter' }
    });

    // Should render matching skills
    assert.match(html, />\s*JavaScript\s*</);
    assert.match(html, />\s*Node\.js\s*</);
    // Should NOT render non-matching skills as visible badges
    assert.doesNotMatch(html, />\s*Python\s*</);
    assert.doesNotMatch(html, />\s*Ruby\s*</);
});

test('company applicants card renders View Profile as a text link with an arrow symbol', () => {
    const templatePath = path.join(__dirname, '..', 'views', 'company', 'company-applicants.ejs');
    const template = fs.readFileSync(templatePath, 'utf8').replace("<% layout('layouts/boilerplate') %>", '');
    const appId = new mongoose.Types.ObjectId();
    const application = {
        _id: appId,
        status: 'Submitted',
        appliedAt: new Date(),
        matchScore: 70,
        candidate: { name: 'Link Candidate' },
        candidateSkillProfiles: [],
        notes: []
    };

    const html = ejs.render(template, {
        internship: { title: 'Designer', vacancies: 1, companyName: 'Acme' },
        applications: [application],
        user: { _id: new mongoose.Types.ObjectId(), role: 'recruiter' }
    });

    assert.match(html, /<i class="ph-bold ph-arrow-up-right text-xs"><\/i>\s*View Profile/);
    assert.match(html, new RegExp(`href="/company/applications/${appId}/candidate"`));
});

test('company applicants card removes skills when candidate has no skills matching recruiter criteria', () => {
    const templatePath = path.join(__dirname, '..', 'views', 'company', 'company-applicants.ejs');
    const template = fs.readFileSync(templatePath, 'utf8').replace("<% layout('layouts/boilerplate') %>", '');
    const appId = new mongoose.Types.ObjectId();
    const candidateSkills = ['Python', 'Django', 'PostgreSQL'];
    const application = {
        _id: appId,
        status: 'Submitted',
        appliedAt: new Date(),
        matchScore: 30,
        candidate: {
            name: 'No Match Candidate',
            skills: candidateSkills
        },
        candidateSkillProfiles: candidateSkills.map(name => ({ name, proficiency: 'Intermediate' })),
        notes: []
    };

    const html = ejs.render(template, {
        internship: {
            title: 'Frontend Intern',
            vacancies: 1,
            companyName: 'Acme',
            requiredSkills: ['React', 'Vue'],
            minQualifications: 'B.Tech'
        },
        applications: [application],
        user: { _id: new mongoose.Types.ObjectId(), role: 'recruiter' }
    });

    assert.doesNotMatch(html, />\s*Python\s*</);
    assert.doesNotMatch(html, />\s*Django\s*</);
    assert.doesNotMatch(html, />\s*PostgreSQL\s*</);
    assert.doesNotMatch(html, /aria-label="[^"]*proficiency:/);
});

