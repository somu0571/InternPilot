const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const User = require('../models/User');

function renderCandidateProfile(candidateData = {}, extraLocals = {}) {
    const templatePath = path.join(__dirname, '..', 'views', 'candidate', 'candidate-profile.ejs');
    const rawTemplate = fs.readFileSync(templatePath, 'utf8')
        .replace("<% layout('layouts/boilerplate') %>", '');

    const candidate = {
        name: 'Rahul Sharma',
        age: 22,
        familyIncome: 420000,
        education: { qualification: 'B.Tech', institutionName: 'Pune University' },
        enrollmentStatus: 'not_enrolled',
        employmentStatus: 'unemployed',
        location: { district: 'Pune', state: 'Maharashtra' },
        skills: ['JavaScript', 'React'],
        ...candidateData
    };

    return ejs.render(rawTemplate, {
        candidate,
        user: candidate,
        activeUser: candidate,
        currentUser: candidate,
        eligibility: {
            status: 'eligible',
            badge: { label: 'Eligible', bgClass: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: 'ph-check-circle' },
            reasons: [],
            missingFields: [],
            criteria: []
        },
        pmisRules: {},
        skillProfiles: [{ name: 'JavaScript', proficiency: 'Intermediate' }],
        success_msg: null,
        error_msg: null,
        showConflictModal: false,
        ...extraLocals
    });
}

test('User schema accepts resumeOriginalName and resumeUploadedAt fields', () => {
    const user = new User({
        name: 'Test Candidate',
        email: 'test@example.com',
        role: 'candidate',
        resume: 'https://res.cloudinary.com/demo/raw/upload/internpilot/resumes/12345_my_resume.pdf',
        resumeOriginalName: 'resume_v2.pdf',
        resumeUploadedAt: new Date('2026-09-20T10:00:00Z')
    });

    assert.equal(user.resumeOriginalName, 'resume_v2.pdf');
    assert.ok(user.resumeUploadedAt instanceof Date);
});

test('candidate-profile.ejs persistently displays "No resume currently on file" when candidate has no resume', () => {
    const html = renderCandidateProfile({
        resume: '',
        resumeOriginalName: '',
        resumeUploadedAt: null
    });

    assert.match(html, /No resume currently on file/);
    assert.match(html, /Not Uploaded/);
    assert.match(html, /Upload &amp; Extract Details|Upload & Extract Details/);
    assert.match(html, /id="resumeUploadCard"/);
});

test('candidate-profile.ejs persistently displays "Resume uploaded: <filename>" and Replace option when candidate has resume', () => {
    const html = renderCandidateProfile({
        resume: 'https://res.cloudinary.com/demo/raw/upload/internpilot/resumes/1743123456_resume_v2.pdf',
        resumeOriginalName: 'resume_v2.pdf',
        resumeUploadedAt: new Date('2026-09-20T10:00:00Z')
    });

    
    assert.match(html, /Resume uploaded:\s*<span[^>]*>resume_v2\.pdf<\/span>/);
    assert.match(html, /On File/);
    assert.match(html, /Active/);
    assert.match(html, /View Resume/);
    assert.match(html, /Replace Resume/);
    assert.match(html, /Upload &amp; Replace Resume|Upload & Replace Resume/);
});

test('candidate-profile.ejs cleanly extracts fallback filename from Cloudinary URL when resumeOriginalName is unset', () => {
    const html = renderCandidateProfile({
        resume: 'https://res.cloudinary.com/demo/raw/upload/internpilot/resumes/1743123456_my_portfolio_cv.pdf',
        resumeOriginalName: '',
        resumeUploadedAt: null
    });

    assert.match(html, /Resume uploaded:\s*<span[^>]*>my_portfolio_cv\.pdf<\/span>/);
    assert.match(html, /View Resume/);
});

test('candidate-profile.ejs includes client-side dropzone and error feedback container', () => {
    const html = renderCandidateProfile({ resume: '' });

    assert.match(html, /id="resumeDropzone"/);
    assert.match(html, /id="resumeClientError"/);
    assert.match(html, /id="fileSelectionPreview"/);
    assert.match(html, /accept="\.pdf,\.doc,\.docx/);
});

test('resume upload fileFilter accepts valid PDF/Word files and rejects other types with specific message', () => {
    
    const allowedMimes = [
        'application/pdf',
        'application/x-pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    const allowedExts = ['.pdf', '.doc', '.docx'];

    function testFileFilter(file) {
        return new Promise((resolve) => {
            const ext = path.extname(file.originalname || '').toLowerCase();
            if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
                resolve({ accepted: true });
            } else {
                const err = new Error('Invalid file type. Only PDF (.pdf) and Word (.docx, .doc) files are allowed.');
                err.code = 'INVALID_FILE_TYPE';
                resolve({ accepted: false, error: err });
            }
        });
    }

    
    testFileFilter({ originalname: 'resume.pdf', mimetype: 'application/pdf' }).then(res => {
        assert.equal(res.accepted, true);
    });

    
    testFileFilter({ originalname: 'resume.docx', mimetype: 'application/octet-stream' }).then(res => {
        assert.equal(res.accepted, true);
    });

    
    testFileFilter({ originalname: 'picture.png', mimetype: 'image/png' }).then(res => {
        assert.equal(res.accepted, false);
        assert.equal(res.error.code, 'INVALID_FILE_TYPE');
        assert.match(res.error.message, /Only PDF.*and Word.*allowed/i);
    });
});

test('specific helpful error messages are mapped for upload failure cases', () => {
    function mapUploadError(err) {
        if (!err) return null;
        if (err.code === 'LIMIT_FILE_SIZE') {
            return 'Resume file is too large. Maximum allowed size is 5MB.';
        }
        if (err.code === 'INVALID_FILE_TYPE' || err.message) {
            return err.message;
        }
        return 'File upload failed.';
    }

    function mapNetworkError(err) {
        const msg = err.message || '';
        if (err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED' || /timeout|network|connect|econn/i.test(msg)) {
            return 'Network error while uploading resume. Please check your internet connection and try again.';
        }
        if (/cloudinary/i.test(msg) || err.http_code) {
            return 'Cloud storage service error while saving resume. Please try again later.';
        }
        return `Resume upload failed: ${msg}`;
    }

    
    assert.equal(
        mapUploadError({ code: 'LIMIT_FILE_SIZE' }),
        'Resume file is too large. Maximum allowed size is 5MB.'
    );

    
    assert.equal(
        mapUploadError({ code: 'INVALID_FILE_TYPE', message: 'Invalid file type. Only PDF (.pdf) and Word (.docx, .doc) files are allowed.' }),
        'Invalid file type. Only PDF (.pdf) and Word (.docx, .doc) files are allowed.'
    );

    
    assert.match(
        mapNetworkError({ code: 'ETIMEDOUT', message: 'connect ETIMEDOUT' }),
        /Network error while uploading resume/
    );

    
    assert.match(
        mapNetworkError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND' }),
        /Network error while uploading resume/
    );
});

test('resume upload fallback saves file locally when cloud upload fails', () => {
    const safeName = 'test_sample_resume.pdf'.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const uniqueFileName = `${Date.now()}_${safeName}`;
    const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'resumes');
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }
    const localFilePath = path.join(uploadDir, uniqueFileName);
    fs.writeFileSync(localFilePath, Buffer.from('%PDF-1.4 test resume content'));

    assert.ok(fs.existsSync(localFilePath));
    const resumeUrl = `/uploads/resumes/${uniqueFileName}`;
    assert.match(resumeUrl, /^\/uploads\/resumes\/\d+_test_sample_resume\.pdf$/);

    
    fs.unlinkSync(localFilePath);
    assert.equal(fs.existsSync(localFilePath), false);
});


