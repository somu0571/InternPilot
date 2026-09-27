const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const mongoose = require('mongoose');

const Grievance = require('../models/Grievance');
const Notification = require('../models/Notification');
const g = require('../utils/grievances');

const { GrievanceCounter } = Grievance;
const id = () => new mongoose.Types.ObjectId();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Swaps a method for the length of one test.
async function withStub(target, method, fake, fn) {
    const original = target[method];
    target[method] = fake;
    try {
        return await fn();
    } finally {
        target[method] = original;
    }
}

// A plain grievance with a save() stub, for the functions that save.
function ticket(overrides = {}) {
    return {
        _id: id(),
        ticket: 'GRV-2026-000001',
        raisedBy: id(),
        raiserRole: 'candidate',
        category: 'stipend',
        subject: 'Stipend for August not received',
        description: 'The company has not paid the August stipend yet.',
        status: 'open',
        tier: 1,
        dueAt: new Date('2026-09-28T10:00:00Z'),
        reopenCount: 0,
        updates: [],
        createdAt: new Date('2026-09-26T10:00:00Z'),
        saves: 0,
        async save() { this.saves += 1; return this; },
        ...overrides
    };
}

const view = name => path.join(__dirname, '..', 'views', name);
const render = (file, locals) => ejs.render(
    fs.readFileSync(view(file), 'utf8').replace("<% layout('layouts/boilerplate') %>", ''),
    locals,
    { filename: view(file) }
);

// --- Deadlines ---

test('working days skip Saturday and Sunday', () => {
    // Friday 25 Sep 2026, 10:00 IST.
    const friday = new Date('2026-09-25T04:30:00Z');
    assert.equal(g.addWorkingDays(friday, 1).toISOString(), '2026-09-28T04:30:00.000Z'); // Monday
    assert.equal(g.addWorkingDays(friday, 7).toISOString(), '2026-10-06T04:30:00.000Z'); // Tuesday after next
});

test('weekends are counted in India time, not UTC', () => {
    // Sunday 27 Sep, 02:00 IST is still Saturday in UTC. The next working day is Monday in India.
    const sundayIst = new Date('2026-09-26T20:30:00Z');
    assert.equal(g.addWorkingDays(sundayIst, 1).toISOString(), '2026-09-27T20:30:00.000Z');
});

test('each tier gets the deadline published on /grievance', () => {
    const friday = new Date('2026-09-25T04:30:00Z');
    assert.equal(g.dueDateFor(1, friday) - friday, 48 * HOUR);
    assert.equal(g.dueDateFor(2, friday).toISOString(), g.addWorkingDays(friday, 7).toISOString());
    assert.equal(g.dueDateFor(3, friday).toISOString(), g.addWorkingDays(friday, 15).toISOString());
});

// --- Escalation and closing ---

test('an overdue grievance moves up one tier, stamped with the deadline it missed', () => {
    const due = new Date('2026-09-28T10:00:00Z');
    const item = ticket({ dueAt: due });
    const moved = g.applyEscalations(item, new Date(due.getTime() + HOUR));
    assert.deepEqual(moved, [2]);
    assert.equal(item.tier, 2);
    assert.equal(item.dueAt.toISOString(), g.dueDateFor(2, due).toISOString());
    assert.equal(item.updates[0].kind, 'escalated');
    assert.equal(item.updates[0].byRole, 'system');
    assert.equal(item.updates[0].at.toISOString(), due.toISOString());
});

test('a long-ignored grievance catches up through the tiers and stops at Tier 3', () => {
    const item = ticket({ dueAt: new Date('2026-08-01T10:00:00Z') });
    assert.deepEqual(g.applyEscalations(item, new Date('2026-10-30T10:00:00Z')), [2, 3]);
    assert.equal(item.tier, 3);
    assert.equal(g.isOverdue(item, new Date('2026-10-30T10:00:00Z')), true);
    assert.deepEqual(g.applyEscalations(item, new Date('2026-12-30T10:00:00Z')), []);
});

test('resolved grievances are never escalated', () => {
    const item = ticket({ status: 'resolved', dueAt: new Date('2026-08-01T10:00:00Z') });
    assert.deepEqual(g.applyEscalations(item, new Date('2026-10-30T10:00:00Z')), []);
    assert.equal(item.tier, 1);
});

test('a resolved grievance closes after the 7-day reopen window', () => {
    const resolvedAt = new Date('2026-09-01T10:00:00Z');
    const early = ticket({ status: 'resolved', resolvedAt });
    assert.equal(g.applyAutoClose(early, new Date('2026-09-05T10:00:00Z')), false);
    assert.equal(early.status, 'resolved');

    const late = ticket({ status: 'resolved', resolvedAt });
    assert.equal(g.applyAutoClose(late, new Date('2026-09-09T10:00:00Z')), true);
    assert.equal(late.status, 'closed');
    assert.equal(late.updates[0].at.toISOString(), new Date(resolvedAt.getTime() + 7 * DAY).toISOString());
});

test('reopening is allowed once, within 7 days of the resolution', () => {
    const resolvedAt = new Date('2026-09-01T10:00:00Z');
    const within = new Date('2026-09-05T10:00:00Z');
    assert.equal(g.canReopen(ticket({ status: 'resolved', resolvedAt }), within), true);
    assert.equal(g.canReopen(ticket({ status: 'resolved', resolvedAt, reopenCount: 1 }), within), false);
    assert.equal(g.canReopen(ticket({ status: 'resolved', resolvedAt }), new Date('2026-09-10T10:00:00Z')), false);
    assert.equal(g.canReopen(ticket({ status: 'open' }), within), false);
});

// --- Access and input ---

test('only the raiser and admins can see a grievance', () => {
    const raiser = { _id: id(), role: 'candidate' };
    const item = ticket({ raisedBy: raiser._id });
    assert.equal(g.canView(raiser, item), true);
    assert.equal(g.canView(raiser, { ...item, raisedBy: { _id: raiser._id, name: 'Asha' } }), true);
    assert.equal(g.canView({ _id: id(), role: 'candidate' }, item), false);
    assert.equal(g.canView({ _id: id(), role: 'recruiter' }, item), false);
    assert.equal(g.canView({ _id: id(), role: 'admin' }, item), true);
    assert.equal(g.canView(null, item), false);
});

test('candidates and company teams can raise grievances, admins handle them', () => {
    assert.equal(g.raiserRoleFor({ role: 'candidate' }), 'candidate');
    ['company', 'recruiter', 'hiring_manager'].forEach(role => assert.equal(g.raiserRoleFor({ role }), 'company'));
    assert.equal(g.raiserRoleFor({ role: 'admin' }), null);
    assert.equal(g.raiserRoleFor(null), null);
});

test('the form is validated and markup is kept as plain text', () => {
    const ok = g.validateGrievanceInput({ category: 'stipend', subject: '  Stipend not paid  ', description: 'x'.repeat(30) });
    assert.deepEqual(ok.errors, []);
    assert.equal(ok.value.subject, 'Stipend not paid');

    const bad = g.validateGrievanceInput({ category: 'lottery', subject: 'Hi', description: 'short' });
    assert.equal(bad.errors.length, 3);

    const long = g.validateGrievanceInput({ category: 'other', subject: 'x'.repeat(121), description: 'x'.repeat(4001) });
    assert.equal(long.errors.length, 2);

    const markup = g.validateGrievanceInput({ category: 'other', subject: '<b>Hello</b> there', description: '<script>alert(1)</script> and more text' });
    assert.equal(markup.value.subject, '<b>Hello</b> there');
});

test('ticket numbers read GRV-year-sequence', () => {
    assert.equal(g.formatTicket(2026, 123), 'GRV-2026-000123');
    assert.match(g.formatTicket(2026, 1), g.TICKET_PATTERN);
    assert.doesNotMatch('GRV-2026-12', g.TICKET_PATTERN);
});

test('time left reads naturally both before and after the deadline', () => {
    const now = new Date('2026-09-26T10:00:00Z');
    assert.equal(g.timeLeft(new Date(now.getTime() + DAY + 4 * HOUR), now), 'due in 1 day 4 h');
    assert.equal(g.timeLeft(new Date(now.getTime() - 3 * HOUR), now), 'overdue by 3 h');
    assert.equal(g.timeLeft(new Date(now.getTime() + 10 * 60 * 1000), now), 'due in 1 h');
});

// --- Raising a grievance ---

test('raising checks who you are and what you wrote before touching the database', async () => {
    assert.match((await g.createGrievance({ _id: id(), role: 'admin' }, {})).errors[0], /Only candidates and companies/);
    const invalid = await g.createGrievance({ _id: id(), role: 'candidate' }, { category: 'stipend', subject: 'Hi' });
    assert.ok(invalid.errors.length > 0);
});

test('more than 5 grievances a day is refused', async () => {
    await withStub(Grievance, 'countDocuments', async () => 5, async () => {
        const result = await g.createGrievance({ _id: id(), role: 'candidate' },
            { category: 'stipend', subject: 'Stipend not paid', description: 'x'.repeat(40) });
        assert.equal(result.limited, true);
        assert.match(result.errors[0], /up to 5 grievances a day/);
    });
});

test('a new grievance starts at Tier 1 with a 48-hour deadline and a ticket number', async () => {
    const now = new Date('2026-09-26T10:00:00Z');
    const recruiter = { _id: id(), role: 'recruiter', companyId: id() };
    let created;
    await withStub(Grievance, 'countDocuments', async () => 0, () =>
        withStub(GrievanceCounter, 'findOneAndUpdate', async () => ({ seq: 7 }), () =>
            withStub(Grievance, 'create', async doc => { created = doc; return doc; }, async () => {
                const result = await g.createGrievance(recruiter,
                    { category: 'technical', subject: 'Listing form crashes', description: 'Saving a new listing shows an error page.' }, now);
                assert.equal(result.grievance.ticket, 'GRV-2026-000007');
            })));
    assert.equal(created.tier, 1);
    assert.equal(created.status, 'open');
    assert.equal(created.raiserRole, 'company');
    assert.equal(String(created.companyId), String(recruiter.companyId));
    assert.equal(created.dueAt - now, 48 * HOUR);
    assert.equal(created.updates[0].kind, 'created');
});

// --- Updates and notifications ---

test('grievance notifications are accepted by the notification centre', async () => {
    const note = new Notification({ recipient: id(), type: 'grievance_update', title: 't', message: 'm' });
    await assert.doesNotReject(note.validate());
});

test('company notifications carry only the ticket number, since the whole team sees them', async () => {
    const sent = [];
    await withStub(Notification, 'create', async doc => { sent.push(doc); return doc; }, async () => {
        await g.notifyRaiser(ticket({ raiserRole: 'company', companyId: id() }), 'Private title', 'Private message');
        await g.notifyRaiser(ticket(), 'Candidate title', 'Candidate message');
    });
    assert.ok(sent[0].companyId && !sent[0].recipient);
    assert.doesNotMatch(JSON.stringify(sent[0]), /Private|Stipend/);
    assert.equal(sent[0].link, '/grievances/GRV-2026-000001');
    assert.ok(sent[1].recipient && sent[1].title === 'Candidate title');
});

test('resolving needs a note, then notifies the raiser and opens the reopen window', async () => {
    const admin = { _id: id(), role: 'admin' };
    const now = new Date('2026-09-26T10:00:00Z');
    const item = ticket();
    const sent = [];
    await withStub(Notification, 'create', async doc => { sent.push(doc); return doc; }, async () => {
        assert.match((await g.adminRespond(item, admin, { status: 'resolved' }, now)).error, /resolution note/);
        assert.equal(item.status, 'open');

        assert.deepEqual(await g.adminRespond(item, admin, { status: 'resolved', message: 'Paid on 25 Sep.' }, now), { ok: true });
    });
    assert.equal(item.status, 'resolved');
    assert.equal(item.resolvedAt, now);
    assert.deepEqual(item.updates.map(u => u.kind), ['response', 'status']);
    assert.equal(sent.length, 1);
    assert.equal(g.canReopen(item, now), true);
});

test('the raiser can reopen once with a reason, which resets the deadline', async () => {
    const raiser = { _id: id(), role: 'candidate' };
    const now = new Date('2026-09-27T10:00:00Z');
    const item = ticket({ raisedBy: raiser._id, status: 'resolved', resolvedAt: new Date('2026-09-26T10:00:00Z'), tier: 2 });
    assert.match((await g.reopenGrievance(item, raiser, '   ', now)).error, /why/);
    assert.deepEqual(await g.reopenGrievance(item, raiser, 'Still not paid.', now), { ok: true });
    assert.equal(item.status, 'open');
    assert.equal(item.reopenCount, 1);
    assert.equal(item.dueAt.toISOString(), g.dueDateFor(2, now).toISOString());
    item.status = 'resolved';
    item.resolvedAt = now;
    assert.match((await g.reopenGrievance(item, raiser, 'Again', now)).error, /once/);
});

test('replies need an open grievance; admins can escalate up to Tier 3', async () => {
    const raiser = { _id: id(), role: 'candidate' };
    const admin = { _id: id(), role: 'admin' };
    assert.match((await g.addRaiserReply(ticket({ status: 'closed' }), raiser, 'hello')).error, /no longer open/);

    const item = ticket({ tier: 2 });
    await withStub(Notification, 'create', async doc => doc, async () => {
        assert.deepEqual(await g.adminEscalate(item, admin), { ok: true });
        assert.equal(item.tier, 3);
        assert.match((await g.adminEscalate(item, admin)).error, /already at Tier 3/);
    });
});

// --- Pages ---

const shown = (overrides = {}, now = new Date('2026-09-26T12:00:00Z')) => g.present(ticket({
    updates: [
        { kind: 'created', byRole: 'raiser', at: new Date('2026-09-26T10:00:00Z') },
        { kind: 'response', byRole: 'admin', message: '<img src=x onerror=alert(1)> checking', at: new Date('2026-09-26T11:00:00Z') }
    ],
    ...overrides
}), now);

test('the ticket page escapes everything people typed', () => {
    const html = render('grievances/show.ejs', {
        g: shown({ subject: '<script>alert(1)</script>', description: '<b>bold</b>' }),
        isAdmin: false,
        statuses: g.STATUS,
        limits: g.LIMITS
    });
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>|<img src=x|<b>bold<\/b>/);
    assert.match(html, /&lt;script&gt;/);
});

test('raisers get a reply box, admins get respond and escalate', () => {
    const raiserHtml = render('grievances/show.ejs', { g: shown(), isAdmin: false, statuses: g.STATUS, limits: g.LIMITS });
    assert.match(raiserHtml, /id="replyForm"/);
    assert.doesNotMatch(raiserHtml, /id="respondForm"/);

    const adminHtml = render('grievances/show.ejs', { g: shown(), isAdmin: true, statuses: g.STATUS, limits: g.LIMITS });
    assert.match(adminHtml, /id="respondForm"/);
    assert.match(adminHtml, /id="escalateForm"/);
    assert.doesNotMatch(adminHtml, /id="replyForm"/);

    const tier3 = render('grievances/show.ejs', { g: shown({ tier: 3 }), isAdmin: false, statuses: g.STATUS, limits: g.LIMITS });
    assert.match(tier3, /pgportal\.gov\.in/);
});

test('an overdue ticket is flagged on the admin desk', () => {
    const now = new Date('2026-09-30T12:00:00Z');
    const html = render('grievances/admin.ejs', {
        items: [shown({ raisedBy: { name: 'Asha Rao' } }, now)],
        counts: { active: 1, overdue: 1, open: 1, in_review: 0, resolved: 0, closed: 0 },
        filters: { status: '', tier: '', category: '', overdue: false },
        categories: g.CATEGORIES,
        statuses: g.STATUS,
        tiers: g.TIERS
    });
    assert.match(html, /data-ticket="GRV-2026-000001"/);
    assert.match(html, /overdue by/);
    assert.match(html, /Asha Rao/);
});

test('the form keeps what was typed and lists the errors', () => {
    const html = render('grievances/new.ejs', {
        categories: g.CATEGORIES,
        tiers: g.TIERS,
        limits: g.LIMITS,
        linkOptions: [{ value: 'application:abc', label: 'Backend Intern (Acme)' }],
        values: { category: 'stipend', subject: 'Stipend not paid', link: 'application:abc' },
        errors: ['Describe the problem in at least 20 characters.']
    });
    assert.match(html, /Describe the problem in at least 20 characters/);
    assert.match(html, /value="stipend" selected/);
    assert.match(html, /value="application:abc" selected/);
});

test('the policy page links to raising and tracking grievances', () => {
    const html = render('extras/grievance.ejs', {});
    assert.match(html, /href="\/grievances\/new"/);
    assert.match(html, /href="\/grievances\/mine"/);
});

test('the admin dashboard shows the grievance card only when counts are loaded', () => {
    const locals = {
        user: { name: 'Admin' },
        stats: { candidates: 1, companies: 1, pendingVerifications: 0 },
        pendingCompanies: [],
        recentUsers: []
    };
    const withCard = render('admin/dashboard.ejs', { ...locals, grievanceSummary: { active: 3, overdue: 1 } });
    assert.match(withCard, /id="grievanceDeskCard"/);
    assert.match(withCard, /1 overdue/);
    assert.doesNotMatch(render('admin/dashboard.ejs', locals), /id="grievanceDeskCard"/);
});

test('the admin dashboard collects company rejection reasons in a modal', () => {
    const html = render('admin/dashboard.ejs', {
        user: { name: 'Admin User' },
        stats: { candidates: 1, companies: 1, pendingVerifications: 1 },
        pendingCompanies: [{
            _id: 'company-123',
            name: 'Acme',
            email: 'admin@acme.test',
            companyDetails: { companyName: 'Acme Labs', cin: 'CIN-123' }
        }],
        approvedCompanies: [],
        recentUsers: []
    });
    assert.match(html, /data-reject-action="\/admin\/reject-company\/company-123"/);
    assert.match(html, /<dialog id="rejectCompanyDialog"/);
    assert.match(html, /<textarea id="rejectCompanyReason" name="reason" required/);
    assert.doesNotMatch(html, /placeholder="Reason for rejection"/);
});

test('the grievance routes are mounted before the admin and page routes', () => {
    const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const mount = app.indexOf("require('./routes/grievances')");
    assert.ok(mount > -1);
    assert.ok(mount < app.indexOf("app.use('/admin', adminRoutes)"));
    assert.ok(mount < app.indexOf("app.use('/', pagesRoutes)"));
});
