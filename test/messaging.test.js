const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ejs = require('ejs');
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const {
    MAX_MESSAGE_LENGTH,
    isReadOnlyStatus,
    resolveCompanyId,
    sideFor,
    sideForApplication,
    validateMessageBody,
    previewOf,
    createRateLimiter,
    hasUnread,
    lastReadAt,
    inboxQuery,
    startableApplications
} = require('../utils/messaging');

const id = () => new mongoose.Types.ObjectId();

const companyId = id();
const otherCompanyId = id();
const candidate = { _id: id(), role: 'candidate' };
const otherCandidate = { _id: id(), role: 'candidate' };
const owner = { _id: companyId, role: 'company' };            
const recruiter = { _id: id(), role: 'recruiter', companyId };
const hiringManager = { _id: id(), role: 'hiring_manager', companyId };
const outsider = { _id: id(), role: 'recruiter', companyId: otherCompanyId };
const admin = { _id: id(), role: 'admin' };

const conversation = { _id: id(), candidate: candidate._id, company: companyId };

test('only the candidate and the hiring company can see a thread', () => {
    assert.equal(sideFor(candidate, conversation), 'candidate');
    assert.equal(sideFor(owner, conversation), 'company');
    assert.equal(sideFor(recruiter, conversation), 'company');
    assert.equal(sideFor(hiringManager, conversation), 'company');

    assert.equal(sideFor(otherCandidate, conversation), null, 'another candidate');
    assert.equal(sideFor(outsider, conversation), null, 'a recruiter at another company');
    assert.equal(sideFor(admin, conversation), null);
    assert.equal(sideFor(null, conversation), null);
    assert.equal(sideFor(candidate, null), null);
});

test('populated references work the same as raw ids', () => {
    const populated = { candidate: { _id: candidate._id, name: 'A' }, company: { _id: companyId, name: 'C' } };
    assert.equal(sideFor(candidate, populated), 'candidate');
    assert.equal(sideFor(recruiter, populated), 'company');
});

test('an owner account without companyId acts for its own company', () => {
    assert.equal(resolveCompanyId(owner), String(companyId));
    assert.equal(resolveCompanyId(recruiter), String(companyId));
    assert.equal(resolveCompanyId({ _id: id(), role: 'recruiter' }), null, 'a recruiter needs a companyId');
});

test('starting a thread requires owning the application or the listing', () => {
    const application = { _id: id(), candidate: candidate._id };
    const listing = { _id: id(), companyId };
    const legacyListing = { _id: id(), postedBy: companyId };

    assert.equal(sideForApplication(candidate, application, listing), 'candidate');
    assert.equal(sideForApplication(recruiter, application, listing), 'company');
    assert.equal(sideForApplication(owner, application, legacyListing), 'company', 'older listings owned via postedBy');

    assert.equal(sideForApplication(otherCandidate, application, listing), null);
    assert.equal(sideForApplication(outsider, application, listing), null);
    assert.equal(sideForApplication(recruiter, application, { _id: id() }), null, 'listing with no owner');
});

test('withdrawn and rejected applications make the thread read-only', () => {
    ['Withdrawn', 'withdrawn', 'Rejected'].forEach(s => assert.equal(isReadOnlyStatus(s), true, s));
    ['Submitted', 'Under Review', 'Shortlisted', 'Interview', 'Hired', 'pending', undefined]
        .forEach(s => assert.equal(isReadOnlyStatus(s), false, String(s)));
});

test('message bodies are trimmed and length checked', () => {
    assert.deepEqual(validateMessageBody('  hello  '), { body: 'hello' });
    assert.deepEqual(validateMessageBody('line one\r\nline two'), { body: 'line one\nline two' });
    assert.ok(validateMessageBody('   ').error);
    assert.ok(validateMessageBody(undefined).error);
    assert.ok(validateMessageBody({ $gt: '' }).error, 'objects from a crafted body are rejected');
    assert.deepEqual(validateMessageBody('x'.repeat(MAX_MESSAGE_LENGTH)), { body: 'x'.repeat(MAX_MESSAGE_LENGTH) });
    assert.ok(validateMessageBody('x'.repeat(MAX_MESSAGE_LENGTH + 1)).error);
});

test('markup is kept as text, not stripped', () => {
    assert.deepEqual(validateMessageBody('<b>hi</b>'), { body: '<b>hi</b>' });
});

test('previews are one line and capped', () => {
    assert.equal(previewOf('hello\n\n  there'), 'hello there');
    const long = previewOf('a'.repeat(500));
    assert.equal(long.length, 140);
    assert.ok(long.endsWith('…'));
});

test('the rate limiter allows a burst, blocks the next, and recovers', () => {
    let now = 1_000_000;
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => now });

    assert.equal(limiter.hit('u1').allowed, true);
    assert.equal(limiter.hit('u1').allowed, true);
    assert.equal(limiter.hit('u1').allowed, true);

    const blocked = limiter.hit('u1');
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterMs, 60_000);

    assert.equal(limiter.hit('u2').allowed, true, 'limits are per user');

    now += 60_000;
    assert.equal(limiter.hit('u1').allowed, true, 'allowed again once the window has passed');
});

test('unread means a newer message from someone else', () => {
    const t = ms => new Date(Date.UTC(2026, 8, 26, 12, 0, 0) + ms);
    const base = { lastMessageAt: t(0), lastMessageBy: candidate._id, reads: [] };

    assert.equal(hasUnread({ ...base, lastMessageAt: null }, recruiter._id), false, 'no messages yet');
    assert.equal(hasUnread(base, candidate._id), false, 'your own message is never unread');
    assert.equal(hasUnread(base, recruiter._id), true, 'never opened');

    const read = { ...base, reads: [{ user: recruiter._id, at: t(1000) }] };
    assert.equal(lastReadAt(read, recruiter._id).getTime(), t(1000).getTime());
    assert.equal(hasUnread(read, recruiter._id), false, 'read after the last message');
    assert.equal(hasUnread({ ...read, lastMessageAt: t(2000) }, recruiter._id), true, 'a newer message arrived');
});

test('two recruiters at the same company track their own read state', () => {
    const conv = {
        lastMessageAt: new Date('2026-09-26T12:00:10Z'),
        lastMessageBy: candidate._id,
        reads: [{ user: recruiter._id, at: new Date('2026-09-26T12:00:20Z') }]
    };
    assert.equal(hasUnread(conv, recruiter._id), false);
    assert.equal(hasUnread(conv, hiringManager._id), true);
});

test('each role gets the right inbox', () => {
    assert.deepEqual(inboxQuery(candidate), { candidate: candidate._id });
    assert.deepEqual(inboxQuery(recruiter), { company: String(companyId) });
    assert.equal(inboxQuery(admin), null);
    assert.equal(inboxQuery(null), null);
});

test('message notifications are accepted by the notification centre', async () => {
    const note = new Notification({ recipient: candidate._id, type: 'new_message', title: 'New message', message: 'hi' });
    await assert.doesNotReject(note.validate());
    const junk = new Notification({ recipient: candidate._id, type: 'not_a_type', title: 't', message: 'm' });
    await assert.rejects(junk.validate());
});

test('each applicant card gets a Message button once messaging is mounted', () => {
    const templatePath = path.join(__dirname, '..', 'views', 'company', 'company-applicants.ejs');
    const template = fs.readFileSync(templatePath, 'utf8').replace("<% layout('layouts/boilerplate') %>", '');
    const application = {
        _id: id(),
        status: 'Submitted',
        appliedAt: new Date(),
        matchScore: 80,
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
    const locals = {
        internship: { title: 'Backend Intern', vacancies: 1, companyName: 'Acme' },
        applications: [application],
        user: recruiter
    };
    const startForm = `action="/messages/start/${application._id}"`;

    const html = ejs.render(template, { ...locals, messageUnreadCount: 0 }, { filename: templatePath });
    assert.ok(html.includes(startForm));
    
    assert.match(html, /aria-label="Message Asha Rao"/);

    
    assert.ok(!ejs.render(template, locals, { filename: templatePath }).includes(startForm));
});

test('candidates can start a thread only on open applications without one', () => {
    const listing = { title: 'Backend Intern', companyName: 'Acme' };
    const open = { _id: id(), status: 'Shortlisted', internship: listing };
    const alreadyTalking = { _id: id(), status: 'Submitted', internship: listing };
    const rejected = { _id: id(), status: 'Rejected', internship: listing };
    const withdrawn = { _id: id(), status: 'withdrawn', internship: listing };
    const deletedListing = { _id: id(), status: 'Submitted', internship: null };
    
    const inbox = [{ application: { _id: alreadyTalking._id, status: 'Submitted' } }];

    const result = startableApplications([open, alreadyTalking, rejected, withdrawn, deletedListing], inbox);
    assert.deepEqual(result.map(a => a._id), [open._id]);
    assert.deepEqual(startableApplications([open], [{ application: open._id }]), []);
    assert.deepEqual(startableApplications(undefined, undefined), []);
});

test('the candidate inbox lists open applications they can message about', () => {
    const templatePath = path.join(__dirname, '..', 'views', 'messages', 'inbox.ejs');
    const template = fs.readFileSync(templatePath, 'utf8').replace("<% layout('layouts/boilerplate') %>", '');
    const application = { _id: id(), status: 'Submitted', internship: { title: 'Backend Intern', companyName: 'Acme' } };
    const render = locals => ejs.render(template, { conversations: [], canMessage: true, ...locals }, { filename: templatePath });

    const html = render({ viewerSide: 'candidate', startable: [application] });
    assert.ok(html.includes(`action="/messages/start/${application._id}"`));
    assert.match(html, /Message a recruiter/);
    assert.match(html, /Backend Intern/);

    const companyHtml = render({ viewerSide: 'company', startable: [] });
    assert.doesNotMatch(companyHtml, /Message a recruiter/);
    assert.match(companyHtml, /chat button on an applicant card/);
});
