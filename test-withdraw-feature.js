
const mongoose = require('mongoose');
const ejs = require('ejs');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const Application = require('./models/Application');
const { handleApplicationWithdrawal } = require('./routes/candidate');

async function runTests() {
    console.log('=== Starting Verification Test Suite for Issue #28: Withdraw Application ===\n');

    
    
    
    console.log('[Test 1] Testing Application Schema & canWithdraw() / withdraw() transition rules...');

    const candidateId = new mongoose.Types.ObjectId();
    const internshipId = new mongoose.Types.ObjectId();

    
    const appSubmitted = new Application({
        candidate: candidateId,
        internship: internshipId,
        status: 'Submitted'
    });
    assert.strictEqual(appSubmitted.canWithdraw(), true, 'Submitted applications must be withdrawable');

    appSubmitted.withdraw('Found another role');
    assert.strictEqual(appSubmitted.status, 'Withdrawn', 'Status must transition to Withdrawn');
    assert(appSubmitted.withdrawnAt instanceof Date, 'withdrawnAt must be set to Date');
    assert.strictEqual(appSubmitted.withdrawalReason, 'Found another role');

    
    assert.strictEqual(appSubmitted.canWithdraw(), false, 'Already withdrawn application must NOT be withdrawable');
    assert.throws(() => {
        appSubmitted.withdraw('Try again');
    }, /cannot be withdrawn/i, 'Calling withdraw() on already withdrawn app must throw');

    
    const appUnderReview = new Application({
        candidate: candidateId,
        internship: internshipId,
        status: 'Under Review'
    });
    assert.strictEqual(appUnderReview.canWithdraw(), true, 'Under Review application must be withdrawable');

    
    const appRejected = new Application({
        candidate: candidateId,
        internship: internshipId,
        status: 'Rejected'
    });
    assert.strictEqual(appRejected.canWithdraw(), false, 'Rejected application must NOT be withdrawable');
    assert.throws(() => {
        appRejected.withdraw('Withdraw after reject');
    }, /cannot be withdrawn/i, 'Calling withdraw() on rejected app must throw');

    
    const appHired = new Application({
        candidate: candidateId,
        internship: internshipId,
        status: 'hired'
    });
    assert.strictEqual(appHired.canWithdraw(), false, 'Hired application must NOT be withdrawable');

    console.log('✓ Model transition logic and soft-delete audit fields verified successfully\n');

    
    
    
    console.log('[Test 2] Testing Withdrawal Controller / Route Handler Security & Rules...');

    
    function createMockRes() {
        return {
            statusCode: 200,
            jsonData: null,
            redirectedTo: null,
            status(code) {
                this.statusCode = code;
                return this;
            },
            json(data) {
                this.jsonData = data;
                return this;
            },
            redirect(url) {
                this.redirectedTo = url;
                return this;
            },
            get() { return null; }
        };
    }

    
    const reqInvalidId = {
        params: { id: 'invalid-id-format' },
        body: {},
        user: { _id: candidateId, role: 'candidate' },
        xhr: true,
        headers: { accept: 'application/json' },
        is: () => false
    };
    const resInvalidId = createMockRes();
    await handleApplicationWithdrawal(reqInvalidId, resInvalidId);
    assert.strictEqual(resInvalidId.statusCode, 400, 'Invalid ID must return 400');
    assert.strictEqual(resInvalidId.jsonData?.success, false);

    console.log('✓ Controller input validation verified successfully\n');

    
    
    
    console.log('[Test 3] Testing views/candidate/my-applications.ejs rendering...');

    const myAppsTemplatePath = path.join(__dirname, 'views', 'candidate', 'my-applications.ejs');
    const myAppsTemplateRaw = fs.readFileSync(myAppsTemplatePath, 'utf8')
        .replace("<% layout('layouts/boilerplate') %>", "");

    const dummyActiveApp = {
        _id: new mongoose.Types.ObjectId(),
        status: 'Submitted',
        appliedAt: new Date(),
        matchScore: 85,
        internship: {
            _id: new mongoose.Types.ObjectId(),
            title: 'Full Stack Engineer Intern',
            companyName: 'TechCorp Solutions',
            sector: 'Technology',
            monthlyStipend: 20000,
            location: { district: 'Bengaluru', state: 'Karnataka' }
        }
    };

    const dummyWithdrawnApp = {
        _id: new mongoose.Types.ObjectId(),
        status: 'Withdrawn',
        appliedAt: new Date(Date.now() - 86400000 * 5),
        withdrawnAt: new Date(Date.now() - 86400000),
        withdrawalReason: 'Accepted another offer',
        matchScore: 60,
        internship: {
            _id: new mongoose.Types.ObjectId(),
            title: 'DevOps Intern',
            companyName: 'CloudScale Inc',
            sector: 'Cloud Services',
            monthlyStipend: 18000,
            location: 'Remote'
        }
    };

    const renderedMyApps = ejs.render(myAppsTemplateRaw, {
        applications: [dummyActiveApp, dummyWithdrawnApp],
        candidate: { _id: candidateId, name: 'Alice Walker' },
        currentUser: { _id: candidateId, role: 'candidate' }
    });

    
    assert(renderedMyApps.includes('Withdraw Application'), 'Must render Withdraw button for active application');
    assert(renderedMyApps.includes('openWithdrawModal'), 'Must include modal trigger in button onclick');
    assert(renderedMyApps.includes('withdrawConfirmationModal'), 'Must render Tailwind CSS confirmation modal');
    assert(renderedMyApps.includes('Accepted another offer'), 'Must display withdrawal reason for withdrawn app');
    assert(renderedMyApps.includes('Withdrawn'), 'Must render Withdrawn badge');

    console.log('✓ views/candidate/my-applications.ejs renders status buttons, badges, and modal correctly\n');

    
    
    
    console.log('[Test 4] Testing views/recruiter/applicant-list.ejs rendering...');

    const recruiterTemplatePath = path.join(__dirname, 'views', 'recruiter', 'applicant-list.ejs');
    const recruiterTemplateRaw = fs.readFileSync(recruiterTemplatePath, 'utf8')
        .replace("<% layout('layouts/boilerplate') %>", "");

    const recruiterAppActive = {
        _id: new mongoose.Types.ObjectId(),
        status: 'Submitted',
        appliedAt: new Date(),
        matchScore: 92,
        candidate: {
            name: 'Rahul Sharma',
            education: { qualification: 'B.Tech CS' },
            skills: ['Node.js', 'React']
        }
    };

    const recruiterAppWithdrawn = {
        _id: new mongoose.Types.ObjectId(),
        status: 'Withdrawn',
        appliedAt: new Date(Date.now() - 86400000 * 3),
        withdrawnAt: new Date(),
        withdrawalReason: 'Schedule conflict',
        matchScore: 78,
        candidate: {
            name: 'Priya Patel',
            education: { qualification: 'MCA' },
            skills: ['Python', 'Django']
        }
    };

    const renderedRecruiterView = ejs.render(recruiterTemplateRaw, {
        internship: { title: 'Backend Intern' },
        applications: [recruiterAppActive, recruiterAppWithdrawn],
        user: { _id: new mongoose.Types.ObjectId(), role: 'recruiter' }
    });

    assert(renderedRecruiterView.includes('Withdrawn by Candidate'), 'Must render Withdrawn badge for withdrawn candidate');
    assert(renderedRecruiterView.includes('Schedule conflict'), 'Must render withdrawal reason');
    assert(renderedRecruiterView.includes('Inactive (Withdrawn)'), 'Must render inactive notice instead of status dropdown');
    assert(renderedRecruiterView.includes('filterApplicants'), 'Must include applicant filtering logic');

    console.log('✓ views/recruiter/applicant-list.ejs correctly renders Withdrawn badge & inactive controls\n');

    
    
    
    console.log('[Test 5] Testing views/company/company-applicants.ejs rendering...');

    const companyApplicantsPath = path.join(__dirname, 'views', 'company', 'company-applicants.ejs');
    const companyApplicantsRaw = fs.readFileSync(companyApplicantsPath, 'utf8')
        .replace("<% layout('layouts/boilerplate') %>", "");

    const renderedCompanyApplicants = ejs.render(companyApplicantsRaw, {
        internship: { title: 'Backend Intern', vacancies: 2, companyName: 'Acme Corp' },
        applications: [recruiterAppActive, recruiterAppWithdrawn],
        user: { _id: new mongoose.Types.ObjectId(), role: 'recruiter' }
    });

    assert(renderedCompanyApplicants.includes('Withdrawn'), 'Must render Withdrawn badge');
    assert(renderedCompanyApplicants.includes('Candidate withdrew their application'), 'Must suppress employer status dropdown and show Withdrawn indicator');

    console.log('✓ views/company/company-applicants.ejs updated to display Withdrawn status accurately\n');

    console.log('================================================================');
    console.log('=== ALL 5 VERIFICATION SUITES PASSED! ISSUE #28 VERIFIED! ===');
    console.log('================================================================\n');
}

runTests().catch(err => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
});
