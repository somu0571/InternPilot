const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const mongoose = require('mongoose');

const ResumeParse = require('../models/ResumeParse');
const {
    LOW_TEXT_LENGTH,
    summarizeResumeParse,
    parseNotice,
    recordResumeParse,
    loadResumeParse
} = require('../utils/resumeParse');

const longText = 'Experienced student developer. '.repeat(20);
const partialPath = path.join(__dirname, '..', 'views', 'partials', 'resume-parse-summary.ejs');
const partial = fs.readFileSync(partialPath, 'utf8');
const renderPartial = (parse, profile) => ejs.render(partial, { parse, profile }, { filename: partialPath });


async function withStub(target, method, fake, fn) {
    const original = target[method];
    target[method] = fake;
    try {
        return await fn();
    } finally {
        target[method] = original;
    }
}

test('text that could not be read is marked unreadable', () => {
    const summary = summarizeResumeParse({ text: '   \n ', skills: [], qualification: '' });
    assert.equal(summary.status, 'unreadable');
    assert.equal(summary.textLength, 0);
});

test('readable text with nothing matched is marked nothing_found', () => {
    assert.equal(summarizeResumeParse({ text: longText, skills: [], qualification: '' }).status, 'nothing_found');
});

test('little text or a single match is marked low_confidence', () => {
    const shortText = 'x'.repeat(LOW_TEXT_LENGTH - 1);
    assert.equal(summarizeResumeParse({ text: shortText, skills: ['React', 'SQL'], qualification: 'B.Tech' }).status, 'low_confidence');
    assert.equal(summarizeResumeParse({ text: longText, skills: ['Excel'], qualification: '' }).status, 'low_confidence');
});

test('enough text and at least two matches is ok', () => {
    assert.equal(summarizeResumeParse({ text: longText, skills: ['React'], qualification: 'B.Tech' }).status, 'ok');
});

test('found skills are de-duplicated and compared with the profile ignoring case', () => {
    const summary = summarizeResumeParse({
        text: longText,
        skills: ['React', 'react', 'Node.js', 'SQL'],
        qualification: 'B.Tech',
        previousSkills: ['REACT', 'Figma'],
        previousQualification: ' M.Tech '
    });
    assert.deepEqual(summary.skills, ['React', 'Node.js', 'SQL']);
    assert.deepEqual(summary.newSkills, ['Node.js', 'SQL']);
    assert.equal(summary.previousQualification, 'M.Tech');
});

test('only uploads that added nothing get a flash notice', () => {
    assert.match(parseNotice({ status: 'unreadable' }), /couldn't read any text/);
    assert.match(parseNotice({ status: 'nothing_found' }), /didn't recognise any skills or a degree/);
    assert.equal(parseNotice({ status: 'low_confidence' }), null);
    assert.equal(parseNotice({ status: 'ok' }), null);
    assert.equal(parseNotice(null), null);
});

test('recording a parse upserts one record per candidate and flashes problems', async () => {
    const calls = [];
    const flashes = [];
    const user = { _id: new mongoose.Types.ObjectId(), skills: ['React'], education: { qualification: '' } };
    const req = { user, flash: (type, message) => flashes.push([type, message]) };

    await withStub(ResumeParse, 'updateOne', async (...args) => { calls.push(args); }, async () => {
        const saved = await recordResumeParse(req, {
            resumeUrl: '/uploads/resumes/cv.pdf', fileName: 'cv.pdf', text: '', skills: [], qualification: ''
        });
        assert.equal(saved.status, 'unreadable');
        assert.equal(saved.resumeUrl, '/uploads/resumes/cv.pdf');
    });

    assert.equal(calls.length, 1);
    const [filter, update, options] = calls[0];
    assert.deepEqual(filter, { user: user._id });
    assert.equal(update.$set.fileName, 'cv.pdf');
    assert.equal(options.upsert, true);
    assert.equal(flashes.length, 1);
    assert.equal(flashes[0][0], 'error_msg');
});

test('a failed save never breaks the upload', async () => {
    const req = { user: { _id: new mongoose.Types.ObjectId() }, flash: () => {} };
    const originalError = console.error;
    console.error = () => {};
    try {
        await withStub(ResumeParse, 'updateOne', async () => { throw new Error('db down'); }, async () => {
            assert.equal(await recordResumeParse(req, { text: longText, skills: ['React'] }), null);
        });
    } finally {
        console.error = originalError;
    }
    assert.equal(await recordResumeParse({}, {}), null);
});

test('the profile page gets the latest parse with readable dates, for candidates only', async () => {
    const doc = { status: 'ok', parsedAt: new Date('2026-09-26T10:00:00Z'), skills: ['React'] };
    const findOne = () => ({ lean: async () => doc });

    await withStub(ResumeParse, 'findOne', findOne, async () => {
        const res = { locals: {} };
        let nextCalled = false;
        await loadResumeParse({ user: { _id: 'u1', role: 'candidate' } }, res, () => { nextCalled = true; });
        assert.ok(nextCalled);
        assert.equal(res.locals.resumeParse.status, 'ok');
        assert.ok(res.locals.resumeParse.parsedAtLabel.includes('2026'));

        const companyRes = { locals: {} };
        await loadResumeParse({ user: { _id: 'c1', role: 'company' } }, companyRes, () => {});
        assert.equal(companyRes.locals.resumeParse, undefined);
    });
});

test('a failed lookup still lets the profile page load', async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
        await withStub(ResumeParse, 'findOne', () => { throw new Error('db down'); }, async () => {
            let nextCalled = false;
            await loadResumeParse({ user: { _id: 'u1', role: 'candidate' } }, { locals: {} }, () => { nextCalled = true; });
            assert.ok(nextCalled);
        });
    } finally {
        console.error = originalError;
    }
});

const sampleParse = {
    status: 'ok',
    resumeUrl: '/uploads/resumes/cv.pdf',
    fileName: 'cv.pdf',
    parsedAtLabel: '26 Sept 2026, 3:30 pm',
    parsedAgo: '2 hours ago',
    skills: ['React', 'Node.js', 'SQL'],
    newSkills: ['Node.js', 'SQL'],
    qualification: 'B.Tech',
    previousQualification: ''
};
const sampleProfile = {
    resume: '/uploads/resumes/cv.pdf',
    skills: ['React', 'Node.js', 'Figma'],
    education: { qualification: 'B.Tech' }
};

test('the summary shows each found skill and where the profile skills came from', () => {
    const html = renderPartial(sampleParse, sampleProfile);
    assert.match(html, /What we read from your resume/);
    assert.match(html, /data-parse-status="ok"/);
    
    assert.match(html, /data-parse-skill="added"[^>]*>\s*Node\.js/);
    assert.match(html, /data-parse-skill="had"[^>]*>\s*React/);
    assert.match(html, /data-parse-skill="missing"[^>]*>\s*SQL/);
    assert.match(html, /B\.Tech<\/span>\s*<span[^>]*>· added to your profile/);
    assert.match(html, /From this resume \(1\)<\/p>\s*<p[^>]*>Node\.js</);
    assert.match(html, /Added by you \(2\)<\/p>\s*<p[^>]*>React, Figma</);
});

test('a different degree in the profile is pointed out', () => {
    const html = renderPartial(sampleParse, { ...sampleProfile, education: { qualification: 'M.Tech' } });
    assert.match(html, /your profile says M\.Tech/);
});

test('problems are explained instead of leaving the section blank', () => {
    const unreadable = renderPartial({ ...sampleParse, status: 'unreadable', skills: [], newSkills: [], qualification: '' }, sampleProfile);
    assert.match(unreadable, /data-parse-status="unreadable"/);
    
    assert.match(unreadable, /couldn&#39;t read any text from this file/);
    assert.match(unreadable, /No skills from our list were found/);
    assert.match(unreadable, /Not found in your resume/);

    const low = renderPartial({ ...sampleParse, status: 'low_confidence' }, sampleProfile);
    assert.match(low, /some details may be missing/);
});

test('the summary is hidden when the parsed file is not the resume on file', () => {
    assert.doesNotMatch(renderPartial(sampleParse, { ...sampleProfile, resume: '/uploads/resumes/other.pdf' }), /resumeParseSummary/);
    assert.doesNotMatch(renderPartial(null, sampleProfile), /resumeParseSummary/);
});

test('file names and skills from the resume are escaped', () => {
    const html = renderPartial({ ...sampleParse, fileName: '<img src=x onerror=alert(1)>.pdf', skills: ['<b>SQL</b>'] }, sampleProfile);
    assert.doesNotMatch(html, /<img src=x/);
    assert.doesNotMatch(html, /<b>SQL<\/b>/);
    assert.match(html, /&lt;img src=x/);
});

test('the candidate profile page includes the summary when a parse is loaded', () => {
    const templatePath = path.join(__dirname, '..', 'views', 'candidate', 'candidate-profile.ejs');
    const template = fs.readFileSync(templatePath, 'utf8').replace("<% layout('layouts/boilerplate') %>", '');
    const candidate = {
        name: 'Rahul Sharma',
        resume: '/uploads/resumes/cv.pdf',
        resumeOriginalName: 'cv.pdf',
        education: { qualification: 'B.Tech' },
        location: { district: 'Pune', state: 'Maharashtra' },
        skills: ['React', 'Node.js']
    };
    const locals = {
        candidate,
        user: candidate,
        currentUser: candidate,
        eligibility: { status: 'eligible', badge: { label: 'Eligible', bgClass: '', icon: 'ph-check-circle' }, reasons: [], missingFields: [], criteria: [] },
        pmisRules: {},
        success_msg: null,
        error_msg: null,
        showConflictModal: false
    };

    const withParse = ejs.render(template, { ...locals, resumeParse: sampleParse }, { filename: templatePath });
    assert.match(withParse, /id="resumeParseSummary"/);
    
    assert.ok(withParse.indexOf('id="resumeParseSummary"') > withParse.indexOf('id="resumeUploadForm"'));

    const withoutParse = ejs.render(template, locals, { filename: templatePath });
    assert.doesNotMatch(withoutParse, /id="resumeParseSummary"/);
});

test('the parser is wired up: saved on upload, loaded before the profile route', () => {
    const userRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'user.js'), 'utf8');
    const upload = userRoutes.slice(userRoutes.indexOf("router.post('/candidate/parse-resume'"));
    const saveAt = upload.indexOf('recordResumeParse(req');
    assert.ok(saveAt > -1, 'the upload route records the parse');
    assert.ok(saveAt < upload.indexOf('detectProfileConflicts('), 'it records before the conflict step can return early');

    const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const loader = app.indexOf("require('./routes/resumeParse')");
    assert.ok(loader > -1 && loader < app.indexOf('app.use(\'/\', userRoutes)'), 'the loader runs before the profile route');
});
