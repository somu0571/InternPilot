
const mongoose = require('mongoose');
const ejs = require('ejs');
const path = require('path');
const assert = require('assert');
const Internship = require('./models/Internship');

async function runTests() {
    console.log('--- Starting Issue #41 Verification Tests ---');

    
    console.log('\n[Test 1] Testing Internship model status & isPaused sync...');
    const testDoc = new Internship({
        companyName: 'Test Corp',
        title: 'Software Intern',
        status: 'published'
    });

    
    testDoc.status = 'paused';
    assert.strictEqual(testDoc.status, 'paused');
    assert.strictEqual(testDoc.isPaused, true, 'isPaused should be true when status is paused');

    
    testDoc.status = 'published';
    assert.strictEqual(testDoc.status, 'published');
    assert.strictEqual(testDoc.isPaused, false, 'isPaused should be false when status is published');

    
    testDoc.isPaused = true;
    assert.strictEqual(testDoc.isPaused, true);
    assert.strictEqual(testDoc.status, 'paused', 'status should be paused when isPaused is true');

    
    testDoc.isPaused = false;
    assert.strictEqual(testDoc.isPaused, false);
    assert.strictEqual(testDoc.status, 'published');
    console.log('✓ Model status and isPaused sync verified successfully');

    
    console.log('\n[Test 2] Testing views/extras/internship-detail.ejs render when Paused...');
    const dummyPausedInternship = {
        _id: new mongoose.Types.ObjectId(),
        title: 'Backend Engineer Intern',
        companyName: 'Acme Systems',
        sector: 'Technology',
        location: { district: 'Bengaluru', state: 'Karnataka' },
        vacancies: 3,
        monthlyStipend: 25000,
        duration: '6 Months',
        minQualifications: 'B.Tech / MCA',
        requiredSkills: ['Node.js', 'MongoDB', 'Docker'],
        applicationDeadline: new Date(Date.now() + 86400000 * 7),
        status: 'paused',
        isPaused: true
    };

    const detailTemplatePath = path.join(__dirname, 'views', 'extras', 'internship-detail.ejs');
    
    
    const detailEjsContent = require('fs').readFileSync(detailTemplatePath, 'utf8')
        .replace("<% layout('layouts/boilerplate') %>", ""); 

    const renderedPausedDetail = ejs.render(detailEjsContent, {
        internship: dummyPausedInternship,
        candidate: { _id: new mongoose.Types.ObjectId(), role: 'candidate' },
        currentUser: { _id: new mongoose.Types.ObjectId(), role: 'candidate' },
        hasApplied: false,
        isPaused: true
    });

    assert(renderedPausedDetail.includes('Applications for this position are temporarily paused'), 'Banner must be visible when paused');
    assert(renderedPausedDetail.includes('Applications Temporarily Paused'), 'Paused button must be displayed');
    assert(!renderedPausedDetail.includes('ph-paper-plane-tilt'), 'Apply Now must be disabled/hidden when paused');
    console.log('✓ internship-detail.ejs correctly renders paused banner & disables apply button');

    
    console.log('\n[Test 3] Testing views/extras/internship-detail.ejs render when Active...');
    const renderedActiveDetail = ejs.render(detailEjsContent, {
        internship: { ...dummyPausedInternship, status: 'published', isPaused: false },
        candidate: { _id: new mongoose.Types.ObjectId(), role: 'candidate' },
        currentUser: { _id: new mongoose.Types.ObjectId(), role: 'candidate' },
        hasApplied: false,
        isPaused: false
    });

    assert(!renderedActiveDetail.includes('Applications for this position are temporarily paused'), 'Paused banner must NOT be shown when active');
    assert(renderedActiveDetail.includes('Apply Now'), 'Apply Now button must be visible when active');
    console.log('✓ internship-detail.ejs correctly renders active state with Apply Now button');

    
    console.log('\n[Test 4] Testing views/extras/internships.ejs with paused and active listings...');
    const internshipsTemplatePath = path.join(__dirname, 'views', 'extras', 'internships.ejs');
    const internshipsEjsContent = require('fs').readFileSync(internshipsTemplatePath, 'utf8')
        .replace("<% layout('layouts/boilerplate') %>", "");

    const renderedListings = ejs.render(internshipsEjsContent, {
        internships: [
            dummyPausedInternship,
            { ...dummyPausedInternship, _id: new mongoose.Types.ObjectId(), title: 'Frontend Developer Intern', status: 'published', isPaused: false }
        ],
        candidate: { _id: new mongoose.Types.ObjectId(), role: 'candidate' },
        currentUser: { _id: new mongoose.Types.ObjectId(), role: 'candidate' },
        appliedIds: [],
        currentFilter: 'all'
    });

    assert(renderedListings.includes('Applications Paused'), 'Listings must contain Applications Paused filter/badge');
    assert(renderedListings.includes('Active Openings'), 'Listings must contain Active Openings tab');
    assert(renderedListings.includes('Applications are temporarily paused.'), 'Card must show paused notice');
    console.log('✓ internships.ejs correctly renders tabs, paused badges, and cards');

    
    console.log('\n[Test 5] Testing views/company/company-dashboard.ejs recruiter dashboard...');
    const dashboardTemplatePath = path.join(__dirname, 'views', 'company', 'company-dashboard.ejs');
    const dashboardEjsContent = require('fs').readFileSync(dashboardTemplatePath, 'utf8')
        .replace("<% layout('layouts/boilerplate') %>", "");

    const recruiterId = new mongoose.Types.ObjectId();
    const renderedDashboard = ejs.render(dashboardEjsContent, {
        user: { _id: recruiterId, role: 'recruiter', companyId: recruiterId },
        internships: [
            { ...dummyPausedInternship, companyId: recruiterId },
            { ...dummyPausedInternship, _id: new mongoose.Types.ObjectId(), title: 'Active Role', status: 'published', isPaused: false, companyId: recruiterId }
        ],
        totalApplicationsCount: 5,
        publishedCount: 1,
        pausedCount: 1,
        draftCount: 0,
        totalCount: 2,
        currentFilter: 'all',
        appCountMap: {}
    });

    assert(renderedDashboard.includes('Paused (1)'), 'Dashboard must display Paused filter tab with count');
    assert(renderedDashboard.includes('Resume Applications'), 'Dashboard must display Resume button for paused listings');
    assert(renderedDashboard.includes('Pause Applications'), 'Dashboard must display Pause button for active listings');
    console.log('✓ company-dashboard.ejs correctly renders Paused tab and Pause/Resume controls');

    console.log('\n=== ALL 5 VERIFICATION SUITES PASSED! ===\n');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
