const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const mongoose = require('mongoose');

const AdminAuditLog = require('../models/AdminAuditLog');
const AccountSuspension = require('../models/AccountSuspension');
const Announcement = require('../models/Announcement');
const consoleRouter = require('../routes/adminConsole');
const {
    parseRange,
    rangeWindow,
    percentageChange,
    buildFunnel,
    listingRiskFlags,
    isSuspensionEligible,
    announcementVisibleTo,
    toCsv
} = require('../utils/adminConsole');

function hasRoute(router, method, routePath) {
    return router.stack.some(layer => {
        if (!layer.route || !layer.route.methods || !layer.route.methods[method]) return false;
        return Array.isArray(layer.route.path) ? layer.route.path.includes(routePath) : layer.route.path === routePath;
    });
}

test('console analytics helpers use supported ranges and calculate funnel conversion', () => {
    assert.equal(parseRange('7'), 7);
    assert.equal(parseRange('500'), 30);
    const range = rangeWindow(7, new Date('2026-01-10T12:00:00Z'));
    assert.equal(range.start.toISOString(), '2026-01-03T12:00:00.000Z');
    assert.equal(percentageChange(15, 10), 50);
    assert.equal(percentageChange(2, 0), 100);
    const funnel = buildFunnel({ Submitted: 10, 'Under Review': 5, Shortlisted: 2, Interview: 1, Hired: 1 });
    assert.equal(funnel[1].conversion, 50);
    assert.equal(funnel[4].conversion, 100);
});

test('listing risk rules detect suspicious content and valid listings remain unflagged', () => {
    const risky = listingRiskFlags({
        title: 'Pay fee to secure internship',
        description: 'Pay a deposit now. Contact scam@example.com or +91 99999 99999.',
        vacancies: 0,
        monthlyStipend: -1,
        duration: '100 Months',
        companyId: { companyDetails: { isVerified: false } }
    }).map(flag => flag.code);
    assert.ok(risky.includes('fee_or_deposit'));
    assert.ok(risky.includes('contact_email'));
    assert.ok(risky.includes('contact_phone'));
    assert.ok(risky.includes('unverified_company'));

    assert.deepEqual(listingRiskFlags({
        title: 'Software Intern',
        description: 'Work with an engineering team on production tools, code reviews, user research, testing, and documented project outcomes.',
        vacancies: 2,
        monthlyStipend: 15000,
        duration: '6 Months',
        companyId: { companyDetails: { isVerified: true } }
    }), []);
});

test('suspension eligibility protects admins, company owners, and the acting admin', () => {
    const actor = new mongoose.Types.ObjectId();
    assert.equal(isSuspensionEligible({ _id: actor, role: 'candidate' }, actor), false);
    assert.equal(isSuspensionEligible({ _id: new mongoose.Types.ObjectId(), role: 'admin' }, actor), false);
    assert.equal(isSuspensionEligible({ _id: new mongoose.Types.ObjectId(), role: 'company' }, actor), false);
    assert.equal(isSuspensionEligible({ _id: new mongoose.Types.ObjectId(), role: 'recruiter' }, actor), true);
});

test('announcement audiences and CSV exports are safe', () => {
    assert.equal(announcementVisibleTo({ audience: 'all' }, null), true);
    assert.equal(announcementVisibleTo({ audience: 'candidates' }, { role: 'candidate' }), true);
    assert.equal(announcementVisibleTo({ audience: 'companies' }, { role: 'candidate' }), false);
    const csv = toCsv(['Name', 'Value'], [['=SUM(A1:A2)', 'A "quoted" value']]);
    assert.ok(csv.includes("'=SUM(A1:A2)"));
    assert.ok(csv.includes('"A ""quoted"" value"'));
});

test('console-only models define audit, suspension, and scheduled announcement data', async () => {
    const id = new mongoose.Types.ObjectId();
    assert.equal(new AdminAuditLog({ actor: id, action: 'LISTING_PAUSED', targetType: 'Internship', targetId: id }).validateSync(), undefined);
    assert.equal(new AccountSuspension({ subject: id, suspendedBy: id, reason: 'Policy violation' }).validateSync(), undefined);
    const invalid = new Announcement({ title: 'Planned downtime', message: 'Maintenance', startsAt: new Date('2026-02-02'), endsAt: new Date('2026-02-01'), createdBy: id });
    await assert.rejects(invalid.validate(), /End time must be after start time/);
});

test('admin console routes expose every protected console section', () => {
    assert.equal(hasRoute(consoleRouter, 'get', '/admin/console'), true);
    assert.equal(hasRoute(consoleRouter, 'get', '/admin/console/users'), true);
    assert.equal(hasRoute(consoleRouter, 'post', '/admin/console/users/:id/suspend'), true);
    assert.equal(hasRoute(consoleRouter, 'get', '/admin/console/listings'), true);
    assert.equal(hasRoute(consoleRouter, 'post', '/admin/console/listings/:id/moderate'), true);
    assert.equal(hasRoute(consoleRouter, 'get', '/admin/console/applications'), true);
    assert.equal(hasRoute(consoleRouter, 'get', '/admin/console/announcements'), true);
    assert.equal(hasRoute(consoleRouter, 'get', '/admin/console/audit-log'), true);
});

test('admin console views compile with representative empty data', () => {
    const templatePath = path.join(__dirname, '..', 'views', 'admin-console', 'overview.ejs');
    const template = fs.readFileSync(templatePath, 'utf8').replace("<% layout('layouts/boilerplate') %>", '');
    const stat = { current: 0, previous: 0, change: 0 };
    const html = ejs.render(template, {
        analytics: { days: 30, totals: { candidates: stat, companies: stat, listings: stat, applications: stat, hires: stat }, daily: { labels: [], signups: [], applications: [] }, funnel: buildFunnel(), rejected: 0, withdrawn: 0, states: [], topListings: [], skillsGap: [], pmis: { eligible: 0, ineligible: 0, incomplete: 0 } },
        safeJson: JSON.stringify
    }, { filename: templatePath });
    assert.ok(html.includes('Platform overview'));
    assert.ok(html.includes('dailyActivityChart'));
});

test('every console view and the public announcement partial compile', () => {
    const viewDirectory = path.join(__dirname, '..', 'views', 'admin-console');
    const names = ['overview.ejs', 'users.ejs', 'user-detail.ejs', 'listings.ejs', 'applications.ejs', 'announcements.ejs', 'audit-log.ejs'];
    names.forEach(name => {
        const source = fs.readFileSync(path.join(viewDirectory, name), 'utf8')
            .replace("<% layout('layouts/boilerplate') %>", '');
        assert.doesNotThrow(() => ejs.compile(source, { filename: path.join(viewDirectory, name) }), `${name} should compile`);
    });
    const partialPath = path.join(__dirname, '..', 'views', 'partials', 'admin-announcements.ejs');
    assert.doesNotThrow(() => ejs.compile(fs.readFileSync(partialPath, 'utf8'), { filename: partialPath }));
});
