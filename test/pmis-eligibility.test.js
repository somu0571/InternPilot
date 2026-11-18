const test = require('node:test');
const assert = require('node:assert/strict');
const { PMIS_RULES, checkPmisEligibility, formatCurrency } = require('../utils/pmisEligibility');

test('PMIS eligibility: returns Eligible when candidate meets all criteria', () => {
    const candidate = {
        age: 22,
        familyIncome: 450000,
        education: { qualification: 'B.Tech' },
        enrollmentStatus: 'not_enrolled',
        employmentStatus: 'unemployed'
    };

    const result = checkPmisEligibility(candidate);

    assert.equal(result.status, 'eligible');
    assert.equal(result.isEligible, true);
    assert.equal(result.badge.label, 'Eligible');
    assert.equal(result.badge.colorClass, 'emerald');
    assert.equal(result.reasons.length, 0);
    assert.equal(result.missingFields.length, 0);
    assert.ok(result.criteria.every(c => c.status === 'pass'));
});

test('PMIS eligibility: boundary age values 21 and 24 are eligible', () => {
    const minAgeCandidate = {
        age: 21,
        familyIncome: 800000,
        education: { qualification: 'Diploma' },
        enrollmentStatus: 'not_enrolled',
        employmentStatus: 'unemployed'
    };
    const maxAgeCandidate = {
        age: 24,
        familyIncome: 800000,
        education: { qualification: 'B.Com' },
        enrollmentStatus: 'not_enrolled',
        employmentStatus: 'unemployed'
    };

    const minResult = checkPmisEligibility(minAgeCandidate);
    const maxResult = checkPmisEligibility(maxAgeCandidate);

    assert.equal(minResult.status, 'eligible');
    assert.equal(maxResult.status, 'eligible');
});

test('PMIS eligibility: returns Not Eligible when age is below 21', () => {
    const candidate = {
        age: 20,
        familyIncome: 300000,
        education: { qualification: '12th' },
        enrollmentStatus: 'not_enrolled',
        employmentStatus: 'unemployed'
    };

    const result = checkPmisEligibility(candidate);

    assert.equal(result.status, 'ineligible');
    assert.equal(result.isEligible, false);
    assert.equal(result.badge.label, 'Not Eligible');
    assert.equal(result.badge.colorClass, 'rose');
    assert.ok(result.reasons.some(r => r.includes('below the minimum required age of 21')));
});

test('PMIS eligibility: returns Not Eligible when age is above 24', () => {
    const candidate = {
        age: 25,
        familyIncome: 300000,
        education: { qualification: 'BCA' },
        enrollmentStatus: 'not_enrolled',
        employmentStatus: 'unemployed'
    };

    const result = checkPmisEligibility(candidate);

    assert.equal(result.status, 'ineligible');
    assert.equal(result.isEligible, false);
    assert.ok(result.reasons.some(r => r.includes('exceeds the maximum permitted age of 24')));
});

test('PMIS eligibility: returns Not Eligible when family income exceeds ₹8,00,000', () => {
    const candidate = {
        age: 22,
        familyIncome: 850000,
        education: { qualification: 'B.Tech' },
        enrollmentStatus: 'not_enrolled',
        employmentStatus: 'unemployed'
    };

    const result = checkPmisEligibility(candidate);

    assert.equal(result.status, 'ineligible');
    assert.equal(result.isEligible, false);
    assert.ok(result.reasons.some(r => r.includes('exceeds the maximum ceiling of ₹8,00,000')));
});

test('PMIS eligibility: returns Not Eligible when enrolled in full-time formal education', () => {
    const candidate = {
        age: 22,
        familyIncome: 400000,
        education: { qualification: 'B.Sc' },
        enrollmentStatus: 'full_time',
        employmentStatus: 'unemployed'
    };

    const result = checkPmisEligibility(candidate);

    assert.equal(result.status, 'ineligible');
    assert.equal(result.isEligible, false);
    assert.ok(result.reasons.some(r => r.includes('full-time formal education')));
});

test('PMIS eligibility: returns Not Eligible when in full-time regular employment', () => {
    const candidate = {
        age: 23,
        familyIncome: 400000,
        education: { qualification: 'B.Sc' },
        enrollmentStatus: 'not_enrolled',
        employmentStatus: 'full_time'
    };

    const result = checkPmisEligibility(candidate);

    assert.equal(result.status, 'ineligible');
    assert.equal(result.isEligible, false);
    assert.ok(result.reasons.some(r => r.includes('full-time regular employment')));
});

test('PMIS eligibility: returns Incomplete with missing fields when profile lacks required data', () => {
    const candidate = {
        name: 'Incomplete Candidate',
        location: { district: 'Delhi', state: 'Delhi' }
        
    };

    const result = checkPmisEligibility(candidate);

    assert.equal(result.status, 'incomplete');
    assert.equal(result.isEligible, false);
    assert.equal(result.badge.label, 'Incomplete — More Info Needed');
    assert.equal(result.badge.colorClass, 'amber');
    assert.ok(result.missingFields.some(f => f.includes('Age')));
    assert.ok(result.missingFields.some(f => f.includes('Annual family income')));
    assert.ok(result.missingFields.some(f => f.includes('qualification')));
    assert.ok(result.missingFields.some(f => f.includes('Enrollment status')));
    assert.ok(result.missingFields.some(f => f.includes('Employment status')));
});

test('PMIS eligibility: disqualifying condition takes precedence over incomplete info', () => {
    const candidate = {
        age: 30, 
        
        enrollmentStatus: 'not_enrolled',
        employmentStatus: 'unemployed'
    };

    const result = checkPmisEligibility(candidate);

    assert.equal(result.status, 'ineligible');
    assert.equal(result.isEligible, false);
    assert.ok(result.reasons.some(r => r.includes('exceeds the maximum permitted age of 24')));
    assert.ok(result.missingFields.length > 0);
});

test('PMIS eligibility: supports custom configurable rules override', () => {
    const customRules = {
        age: { min: 18, max: 28 },
        familyIncome: { max: 1200000 }
    };

    const candidate = {
        age: 26,
        familyIncome: 1000000,
        education: { qualification: 'M.Tech' },
        enrollmentStatus: 'not_enrolled',
        employmentStatus: 'unemployed'
    };

    
    const defaultResult = checkPmisEligibility(candidate);
    assert.equal(defaultResult.status, 'ineligible');

    
    const customResult = checkPmisEligibility(candidate, customRules);
    assert.equal(customResult.status, 'eligible');
    assert.equal(customResult.isEligible, true);
    assert.match(customResult.criteria[0].message, /18–28/);
    assert.match(customResult.criteria[1].message, /₹12,00,000/);
});

test('PMIS eligibility: age value <= 0 is treated as missing, not disqualifying', () => {
    const candidate = {
        age: 0,
        familyIncome: 400000,
        education: { qualification: 'B.Tech' },
        enrollmentStatus: 'not_enrolled',
        employmentStatus: 'unemployed'
    };

    const result = checkPmisEligibility(candidate);
    assert.equal(result.status, 'incomplete');
    assert.equal(result.isEligible, false);
    assert.ok(result.missingFields.some(f => f.includes('Age')));
    assert.equal(result.reasons.length, 0);
});

test('PMIS eligibility: formatCurrency formats amounts in Indian numbering', () => {
    assert.equal(formatCurrency(800000), '₹8,00,000');
    assert.equal(formatCurrency(50000), '₹50,000');
    assert.equal(formatCurrency('abc'), '₹N/A');
});

test('candidate-profile.ejs renders Eligible badge and checklist for eligible candidate', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const ejs = require('ejs');

    const templatePath = path.join(__dirname, '..', 'views', 'candidate', 'candidate-profile.ejs');
    const rawTemplate = fs.readFileSync(templatePath, 'utf8')
        .replace("<% layout('layouts/boilerplate') %>", '');

    const candidate = {
        name: 'Rahul Sharma',
        age: 22,
        familyIncome: 420000,
        education: { qualification: 'ITI', institutionName: 'Pune ITI' },
        enrollmentStatus: 'not_enrolled',
        employmentStatus: 'unemployed',
        location: { district: 'Pune', state: 'Maharashtra' },
        skills: ['Wiring']
    };

    const eligibility = checkPmisEligibility(candidate);

    const html = ejs.render(rawTemplate, {
        candidate,
        user: candidate,
        activeUser: candidate,
        eligibility,
        pmisRules: PMIS_RULES,
        success_msg: null,
        error_msg: null,
        showConflictModal: false
    });

    assert.match(html, /id="headerEligibilityBadge"/);
    assert.match(html, /id="cardEligibilityBadge"/);
    assert.match(html, /Eligible/);
    assert.match(html, /You meet all eligibility criteria under the Prime Minister's Internship Scheme!/);
    assert.match(html, /Age \(21–24 years\)/);
    assert.match(html, /Formal Education Status/);
    assert.match(html, /Employment Status/);
    assert.match(html, /id="liveEligibilityPreview"/);
});

test('candidate-profile.ejs renders Not Eligible badge and disqualifying reasons', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const ejs = require('ejs');

    const templatePath = path.join(__dirname, '..', 'views', 'candidate', 'candidate-profile.ejs');
    const rawTemplate = fs.readFileSync(templatePath, 'utf8')
        .replace("<% layout('layouts/boilerplate') %>", '');

    const candidate = {
        name: 'Overaged Candidate',
        age: 26,
        familyIncome: 950000,
        education: { qualification: 'B.Tech' },
        enrollmentStatus: 'full_time',
        employmentStatus: 'full_time',
        location: { district: 'Noida', state: 'UP' },
        skills: []
    };

    const eligibility = checkPmisEligibility(candidate);

    const html = ejs.render(rawTemplate, {
        candidate,
        user: candidate,
        activeUser: candidate,
        eligibility,
        pmisRules: PMIS_RULES,
        success_msg: null,
        error_msg: null,
        showConflictModal: false
    });

    assert.match(html, /Not Eligible/);
    assert.match(html, /Disqualifying Criteria Identified:/);
    assert.match(html, /exceeds the maximum permitted age of 24/);
    assert.match(html, /exceeds the maximum ceiling of ₹8,00,000/);
    assert.match(html, /Disqualified/);
});

test('candidate-profile.ejs renders Incomplete badge and lists missing fields with CTA', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const ejs = require('ejs');

    const templatePath = path.join(__dirname, '..', 'views', 'candidate', 'candidate-profile.ejs');
    const rawTemplate = fs.readFileSync(templatePath, 'utf8')
        .replace("<% layout('layouts/boilerplate') %>", '');

    const candidate = {
        name: 'New Candidate',
        location: { district: 'Jaipur', state: 'Rajasthan' },
        skills: []
    };

    const eligibility = checkPmisEligibility(candidate);

    const html = ejs.render(rawTemplate, {
        candidate,
        user: candidate,
        activeUser: candidate,
        eligibility,
        pmisRules: PMIS_RULES,
        success_msg: null,
        error_msg: null,
        showConflictModal: false
    });

    assert.match(html, /Incomplete — More Info Needed/);
    assert.match(html, /Profile Incomplete — More Information Needed/);
    assert.match(html, /Complete Profile/);
    assert.match(html, /Age is not specified/);
    assert.match(html, /Annual family income is not specified/);
});

test('candidate-profile.ejs renders updated employmentStatus, enrollmentStatus and PMIS status accurately', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const ejs = require('ejs');

    const templatePath = path.join(__dirname, '..', 'views', 'candidate', 'candidate-profile.ejs');
    const rawTemplate = fs.readFileSync(templatePath, 'utf8')
        .replace("<% layout('layouts/boilerplate') %>", '');

    const candidate = {
        name: 'naya_ladka',
        age: 24,
        familyIncome: 100000,
        education: { qualification: 'B.Tech', institutionName: 'IIT delhi' },
        enrollmentStatus: 'not_enrolled',
        employmentStatus: 'full_time',
        location: { district: 'Noida', state: 'Uttar Pradesh' },
        skills: ['JavaScript']
    };

    const eligibility = checkPmisEligibility(candidate);

    const html = ejs.render(rawTemplate, {
        candidate,
        user: candidate,
        activeUser: candidate,
        eligibility,
        pmisRules: PMIS_RULES,
        success_msg: null,
        error_msg: null,
        showConflictModal: false
    });

    assert.match(html, /Not Eligible/);
    assert.match(html, /Full-time Employed/);
    assert.match(html, /Not Enrolled \/ Completed/);
    assert.match(html, /Candidates currently engaged in full-time regular employment are not eligible/);
});


