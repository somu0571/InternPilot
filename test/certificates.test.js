const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const mongoose = require('mongoose');

const Certificate = require('../models/Certificate');
const Notification = require('../models/Notification');
const { generateCertificateId, isValidCertificateId } = require('../utils/certificateId');
const { sendCertificateIssuedEmail } = require('../utils/sendEmail');
const certificatesRouter = require('../routes/certificates');

test('Certificate ID generation produces compliant, unique, tamper-proof IDs', () => {
    const currentYear = new Date().getFullYear();
    const id1 = generateCertificateId();
    const id2 = generateCertificateId();

    assert.ok(id1.startsWith(`IP-${currentYear}-`), `Certificate ID "${id1}" must start with IP-${currentYear}-`);
    assert.notEqual(id1, id2, 'Two consecutive certificate IDs must be cryptographically unique');
    assert.equal(isValidCertificateId(id1), true, `"${id1}" must satisfy isValidCertificateId`);
    assert.equal(isValidCertificateId(id2), true, `"${id2}" must satisfy isValidCertificateId`);

    // Negative tests for invalid IDs
    assert.equal(isValidCertificateId(''), false);
    assert.equal(isValidCertificateId(null), false);
    assert.equal(isValidCertificateId('IP-2026-INVALID'), false);
    assert.equal(isValidCertificateId('IP-2026-0000-0000'), false, 'ID with ambiguous 0 must be rejected');
});

test('Certificate model validates required fields and enum constraints', () => {
    const invalidCert = new Certificate({});
    const validationError = invalidCert.validateSync();

    assert.ok(validationError, 'Validation error expected when required fields are missing');
    assert.ok(validationError.errors.certificateId, 'certificateId is required');
    assert.ok(validationError.errors.application, 'application is required');
    assert.ok(validationError.errors.candidate, 'candidate is required');
    assert.ok(validationError.errors.company, 'company is required');
    assert.ok(validationError.errors.internship, 'internship is required');
    assert.ok(validationError.errors.candidateName, 'candidateName is required');
    assert.ok(validationError.errors.companyName, 'companyName is required');
    assert.ok(validationError.errors.internshipTitle, 'internshipTitle is required');

    // Valid certificate document creation (in-memory)
    const validCert = new Certificate({
        certificateId: generateCertificateId(),
        application: new mongoose.Types.ObjectId(),
        candidate: new mongoose.Types.ObjectId(),
        company: new mongoose.Types.ObjectId(),
        issuedBy: new mongoose.Types.ObjectId(),
        internship: new mongoose.Types.ObjectId(),
        candidateName: 'Aarav Sharma',
        candidateEmail: 'aarav@example.com',
        companyName: 'Bharat Innovations Ltd',
        internshipTitle: 'Full Stack Development Intern',
        completionDate: new Date(),
        duration: '3 Months',
        performanceRating: 'Outstanding',
        skills: ['Node.js', 'React', 'MongoDB'],
        signatoryName: 'Dr. Priya Verma',
        signatoryTitle: 'Head of Engineering'
    });

    const validError = validCert.validateSync();
    assert.equal(validError, undefined, 'Valid certificate must pass validation without errors');
    assert.equal(validCert.status, 'Issued', 'Default status must be "Issued"');
    assert.equal(validCert.performanceRating, 'Outstanding');
});

test('Certificate model rejects invalid performanceRating or status enums', () => {
    const certBadRating = new Certificate({
        certificateId: generateCertificateId(),
        application: new mongoose.Types.ObjectId(),
        candidate: new mongoose.Types.ObjectId(),
        company: new mongoose.Types.ObjectId(),
        issuedBy: new mongoose.Types.ObjectId(),
        internship: new mongoose.Types.ObjectId(),
        candidateName: 'Test Candidate',
        companyName: 'Test Company',
        internshipTitle: 'Test Role',
        duration: '3 Months',
        performanceRating: 'InvalidRating'
    });

    const error = certBadRating.validateSync();
    assert.ok(error?.errors?.performanceRating, 'Must reject invalid performanceRating enum value');
});

test('Notification model supports certificate_issued type enum', () => {
    const notif = new Notification({
        recipient: new mongoose.Types.ObjectId(),
        type: 'certificate_issued',
        title: 'Certificate of Completion Issued!',
        message: 'Your certificate is ready.',
        link: '/certificates/IP-2026-TEST-1234/view'
    });

    const error = notif.validateSync();
    assert.equal(error?.errors?.type, undefined, 'Notification schema must accept "certificate_issued" type');
});

test('sendCertificateIssuedEmail handles invalid emails gracefully without crashing', async () => {
    const invalidResult = await sendCertificateIssuedEmail(
        'not-an-email',
        'Candidate Name',
        'Company Name',
        'Developer Intern',
        'IP-2026-TEST-1234',
        'http://localhost:5000/certificates/IP-2026-TEST-1234/view'
    );
    assert.equal(invalidResult, null, 'Must safely return null for invalid recipient email');
});

test('certificates router defines all required endpoints', () => {
    assert.ok(certificatesRouter, 'certificates router must be defined');

    const registeredRoutes = certificatesRouter.stack
        .filter(layer => layer.route)
        .map(layer => ({
            path: layer.route.path,
            methods: Object.keys(layer.route.methods)
        }));

    const hasRoute = (path, method) => registeredRoutes.some(
        r => r.path === path && r.methods.includes(method.toLowerCase())
    );

    assert.ok(hasRoute('/company/applications/:id/certificate/issue', 'get'), 'GET /company/applications/:id/certificate/issue must be defined');
    assert.ok(hasRoute('/company/applications/:id/certificate/issue', 'post'), 'POST /company/applications/:id/certificate/issue must be defined');
    assert.ok(hasRoute('/candidate/certificates', 'get'), 'GET /candidate/certificates must be defined');
    assert.ok(hasRoute('/certificates/:certificateId/view', 'get'), 'GET /certificates/:certificateId/view must be defined');
    assert.ok(hasRoute('/verify/certificate', 'get'), 'GET /verify/certificate must be defined');
    assert.ok(hasRoute('/verify/certificate/:certificateId', 'get'), 'GET /verify/certificate/:certificateId must be defined');
    assert.ok(hasRoute('/api/certificates/:certificateId/verify', 'get'), 'GET /api/certificates/:certificateId/verify must be defined');
});

test('certificate presentation view (view.ejs) renders with all required credential elements and print styling', () => {
    const templatePath = path.join(__dirname, '..', 'views', 'certificates', 'view.ejs');
    assert.ok(fs.existsSync(templatePath), 'view.ejs must exist in views/certificates/');
    const rawTemplate = fs.readFileSync(templatePath, 'utf8').replace("<% layout('layouts/boilerplate') %>", '');

    const mockCert = {
        certificateId: 'IP-2026-AB23-CD45',
        candidateName: 'Rohan Mehra',
        companyName: 'Tech Innovators India Pvt Ltd',
        internshipTitle: 'Machine Learning Intern',
        duration: '6 Months',
        startDate: new Date('2026-01-01'),
        completionDate: new Date('2026-06-30'),
        performanceRating: 'Outstanding',
        skills: ['Python', 'TensorFlow', 'PyTorch'],
        letterOfRecommendation: 'Rohan demonstrated extraordinary diligence, algorithmic innovation, and teamwork.',
        signatoryName: 'Dr. Anita Roy',
        signatoryTitle: 'Vice President of Research',
        qrCodeDataUrl: 'data:image/png;base64,mockQrCodeData'
    };

    const rendered = ejs.render(rawTemplate, {
        certificate: mockCert,
        verifyUrl: 'http://localhost:5000/verify/certificate/IP-2026-AB23-CD45',
        currentUser: null
    }, { filename: templatePath });

    assert.match(rendered, /IP-2026-AB23-CD45/, 'Rendered certificate must display certificateId');
    assert.match(rendered, /Rohan Mehra/, 'Rendered certificate must display candidate name');
    assert.match(rendered, /Tech Innovators India Pvt Ltd/, 'Rendered certificate must display company name');
    assert.match(rendered, /Machine Learning Intern/, 'Rendered certificate must display internship role');
    assert.match(rendered, /Outstanding/, 'Rendered certificate must display rating');
    assert.match(rendered, /TensorFlow/, 'Rendered certificate must display verified skills');
    assert.match(rendered, /Dr\. Anita Roy/, 'Rendered certificate must display signatory name');
    assert.match(rendered, /Official PMIS Seal/, 'Rendered certificate must display official seal');
    assert.match(rendered, /@media print/, 'Rendered view must contain @media print styles');
    assert.match(rendered, /linkedin\.com\/profile\/add/, 'Rendered view must provide Add to LinkedIn button');
    assert.match(rendered, /OFFICIAL LETTER OF RECOMMENDATION/i, 'Rendered view must include LOR sheet when LOR text is present');
});

test('public verification portal view (verify.ejs) correctly renders both verified and not-found states', () => {
    const templatePath = path.join(__dirname, '..', 'views', 'certificates', 'verify.ejs');
    assert.ok(fs.existsSync(templatePath), 'verify.ejs must exist in views/certificates/');
    const rawTemplate = fs.readFileSync(templatePath, 'utf8').replace("<% layout('layouts/boilerplate') %>", '');

    // 1. Initial Search View
    const searchHtml = ejs.render(rawTemplate, {
        certificate: null,
        searchedId: '',
        notFound: false,
        currentUser: null
    }, { filename: templatePath });
    assert.match(searchHtml, /Verify Internship Credentials/);
    assert.match(searchHtml, /name="certificateId"/);

    // 2. Verified Credential View
    const mockVerifiedCert = {
        certificateId: 'IP-2026-VERI-9999',
        candidateName: 'Aditi Deshmukh',
        companyName: 'Wipro Digital',
        internshipTitle: 'Cloud Engineer Intern',
        duration: '3 Months',
        completionDate: new Date('2026-08-15'),
        issuedAt: new Date('2026-08-16'),
        performanceRating: 'Exceeds Expectations',
        skills: ['AWS', 'Docker', 'Kubernetes'],
        signatoryName: 'Vikram Joshi'
    };

    const verifiedHtml = ejs.render(rawTemplate, {
        certificate: mockVerifiedCert,
        searchedId: 'IP-2026-VERI-9999',
        notFound: false,
        currentUser: null
    }, { filename: templatePath });
    assert.match(verifiedHtml, /Officially Verified Credential/);
    assert.match(verifiedHtml, /Aditi Deshmukh/);
    assert.match(verifiedHtml, /Wipro Digital/);
    assert.match(verifiedHtml, /Cloud Engineer Intern/);
    assert.match(verifiedHtml, /IP-2026-VERI-9999/);
    assert.match(verifiedHtml, /Status:\s*Active/);

    // 3. Not Found View
    const notFoundHtml = ejs.render(rawTemplate, {
        certificate: null,
        searchedId: 'IP-2026-FAKE-0000',
        notFound: true,
        currentUser: null
    }, { filename: templatePath });
    assert.match(notFoundHtml, /Credential Not Found/);
    assert.match(notFoundHtml, /IP-2026-FAKE-0000/);
});

test('candidate certificates dashboard view (candidate/certificates.ejs) displays credentials and empty state', () => {
    const templatePath = path.join(__dirname, '..', 'views', 'candidate', 'certificates.ejs');
    assert.ok(fs.existsSync(templatePath), 'certificates.ejs must exist in views/candidate/');
    const rawTemplate = fs.readFileSync(templatePath, 'utf8').replace("<% layout('layouts/boilerplate') %>", '');

    // Empty state
    const emptyHtml = ejs.render(rawTemplate, {
        certificates: [],
        stats: { totalCertificates: 0, totalSkills: 0, withLORCount: 0 },
        currentUser: { role: 'candidate' }
    }, { filename: templatePath });
    assert.match(emptyHtml, /No Certificates Earned Yet/);
    assert.match(emptyHtml, /Browse Opportunities/);

    // Populated state
    const populatedHtml = ejs.render(rawTemplate, {
        certificates: [
            {
                certificateId: 'IP-2026-TEST-7777',
                internshipTitle: 'Frontend Engineer Intern',
                companyName: 'Infosys BPM',
                duration: '4 Months',
                completionDate: new Date('2026-09-01'),
                performanceRating: 'Outstanding',
                skills: ['JavaScript', 'Tailwind CSS'],
                letterOfRecommendation: 'High performer.'
            }
        ],
        stats: { totalCertificates: 1, totalSkills: 2, withLORCount: 1 },
        currentUser: { role: 'candidate' }
    }, { filename: templatePath });
    assert.match(populatedHtml, /Frontend Engineer Intern/);
    assert.match(populatedHtml, /Infosys BPM/);
    assert.match(populatedHtml, /IP-2026-TEST-7777/);
    assert.match(populatedHtml, /Includes Official Recommendation Letter/);
});

test('company issue-certificate view (issue-certificate.ejs) renders full issuance form', () => {
    const templatePath = path.join(__dirname, '..', 'views', 'company', 'issue-certificate.ejs');
    assert.ok(fs.existsSync(templatePath), 'issue-certificate.ejs must exist in views/company/');
    const rawTemplate = fs.readFileSync(templatePath, 'utf8').replace("<% layout('layouts/boilerplate') %>", '');

    const formHtml = ejs.render(rawTemplate, {
        application: { _id: 'app-123', appliedAt: new Date() },
        candidate: { name: 'Siddharth Rao', email: 'sid@example.com' },
        internship: { title: 'AI Research Intern', duration: '6 Months' },
        cName: 'Tata Consultancy Services',
        prefilledSkills: ['Python', 'Deep Learning'],
        user: { name: 'Recruiter Admin' }
    }, { filename: templatePath });

    assert.match(formHtml, /Issue Internship Certificate & LOR/);
    assert.match(formHtml, /Siddharth Rao/);
    assert.match(formHtml, /Tata Consultancy Services/);
    assert.match(formHtml, /name="completionDate"/);
    assert.match(formHtml, /name="duration"/);
    assert.match(formHtml, /name="performanceRating"/);
    assert.match(formHtml, /name="letterOfRecommendation"/);
    assert.match(formHtml, /name="signatoryName"/);
    assert.match(formHtml, /Live Credential Preview/);
});
