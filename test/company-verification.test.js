const test = require('node:test');
const assert = require('node:assert/strict');

const User = require('../models/User');
const Internship = require('../models/Internship');
const {
    companyVerificationStatus,
    isCompanyVerified,
    applyCompanyVerificationDecision,
    startCompanyReverification,
    unpublishCompanyListings
} = require('../utils/companyVerification');
const { requireVerifiedCompany } = require('../middleware/companyAccess');
const companyRouter = require('../routes/company');
const internshipRouter = require('../routes/internships');
const adminRouter = require('../routes/admin');

function response() {
    return {
        statusCode: 200,
        body: null,
        location: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
        redirect(location) {
            this.location = location;
            return this;
        }
    };
}

function hasRoute(router, method, path) {
    return router.stack.some(layer => (
        layer.route && layer.route.path === path && layer.route.methods[method]
    ));
}

test('company verification preserves approved legacy companies and validates new states', () => {
    assert.equal(companyVerificationStatus({ companyDetails: { isVerified: true } }), 'approved');
    assert.equal(companyVerificationStatus({ companyDetails: { isVerified: false } }), 'pending');
    assert.equal(companyVerificationStatus({ companyDetails: { verificationStatus: 'suspended', isVerified: true } }), 'suspended');
    assert.equal(isCompanyVerified({ companyDetails: { verificationStatus: 'approved' } }), true);

    const invalid = new User({
        name: 'Invalid Company',
        email: 'invalid-company@example.com',
        role: 'company',
        companyDetails: { verificationStatus: 'unknown' }
    });
    assert.ok(invalid.validateSync()?.errors['companyDetails.verificationStatus']);
});

test('review decisions and document resubmissions keep a company verification audit trail', () => {
    const company = {
        companyDetails: { isVerified: false },
        _id: 'company-id'
    };
    const reviewerId = 'admin-id';
    const reviewedAt = new Date('2026-09-27T10:00:00.000Z');

    applyCompanyVerificationDecision(company, 'approved', {
        reviewerId,
        reason: 'Registration details match.',
        at: reviewedAt
    });

    assert.equal(company.companyDetails.verificationStatus, 'approved');
    assert.equal(company.companyDetails.isVerified, true);
    assert.equal(company.companyDetails.verificationHistory.length, 1);
    assert.deepEqual(company.companyDetails.verificationHistory[0], {
        status: 'approved',
        reason: 'Registration details match.',
        changedBy: reviewerId,
        changedAt: reviewedAt
    });

    startCompanyReverification(company, { submittedBy: 'company-owner', at: reviewedAt });
    assert.equal(company.companyDetails.verificationStatus, 'pending');
    assert.equal(company.companyDetails.isVerified, false);
    assert.equal(company.companyDetails.verificationHistory.length, 2);
    assert.equal(company.companyDetails.verificationHistory[1].status, 'pending');
});

test('unverified companies can save drafts but cannot publish', async () => {
    const flashes = [];
    const pendingRequest = {
        company: { companyDetails: { verificationStatus: 'pending' } },
        body: { action: 'publish' },
        accepts: () => 'json',
        flash: (...args) => flashes.push(args)
    };
    const pendingResponse = response();
    let reachedHandler = false;

    await requireVerifiedCompany()(pendingRequest, pendingResponse, () => { reachedHandler = true; });
    assert.equal(reachedHandler, false);
    assert.equal(pendingResponse.statusCode, 403);
    assert.equal(pendingResponse.body.verificationRequired, true);
    assert.deepEqual(flashes, [['error_msg', 'Your company must be verified before publishing or resuming internships.']]);

    const draftRequest = {
        company: { companyDetails: { verificationStatus: 'pending' } },
        body: { action: 'draft' },
        flash: () => {}
    };
    await requireVerifiedCompany({ allowDraft: true })(draftRequest, response(), () => { reachedHandler = true; });
    assert.equal(reachedHandler, true);
});

test('unpublishing a rejected or suspended company closes active and paused listings', async t => {
    const originalUpdateMany = Internship.updateMany;
    t.after(() => { Internship.updateMany = originalUpdateMany; });

    let captured;
    const session = { id: 'transaction-session' };
    Internship.updateMany = async (filter, update, options) => {
        captured = { filter, update, options };
        return { modifiedCount: 2 };
    };

    const result = await unpublishCompanyListings('company-id', { session });
    assert.equal(result.modifiedCount, 2);
    assert.deepEqual(captured.filter.status, { $in: ['published', 'paused'] });
    assert.deepEqual(captured.update, { $set: { status: 'closed', isPaused: false } });
    assert.deepEqual(captured.options, { session });
});

test('verification routes and publication safeguards are registered', () => {
    assert.equal(hasRoute(companyRouter, 'post', '/company/verification/documents'), true);
    assert.equal(hasRoute(companyRouter, 'post', '/company/internships/publish/:id'), true);
    assert.equal(hasRoute(companyRouter, 'post', '/company/internships/:id/resume'), true);
    assert.equal(hasRoute(internshipRouter, 'post', '/new'), true);
    assert.equal(hasRoute(internshipRouter, 'post', '/:id/resume'), true);
    assert.equal(hasRoute(adminRouter, 'post', '/suspend-company/:id'), true);
});
