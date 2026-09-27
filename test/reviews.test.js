const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ejs = require('ejs');
const mongoose = require('mongoose');

const Review = require('../models/Review');
const reviewsRouter = require('../routes/reviews');
const { calculateCompanyReviewStats, checkReviewEligibility } = require('../utils/reviews');

// Helper to look up registered routes in router
function findRouteLayer(router, pathPattern, method) {
    return router.stack.find(layer => {
        if (!layer.route || !layer.route.methods[method.toLowerCase()]) return false;
        if (Array.isArray(layer.route.path)) {
            return layer.route.path.includes(pathPattern);
        }
        return layer.route.path === pathPattern;
    });
}

// ---------------------------------------------------------------------------
// 1. Review Model & Schema Tests
// ---------------------------------------------------------------------------

test('Review schema creates a valid instance with all core fields and defaults', () => {
    const companyId = new mongoose.Types.ObjectId();
    const candidateId = new mongoose.Types.ObjectId();
    const internshipId = new mongoose.Types.ObjectId();

    const review = new Review({
        company: companyId,
        candidate: candidateId,
        internship: internshipId,
        roleTitle: 'Frontend Engineering Intern',
        rating: 5,
        mentorshipRating: 4,
        learningCurveRating: 5,
        stipendPunctualityRating: 4,
        workLifeBalanceRating: 4,
        title: 'Outstanding learning curve and supportive mentors',
        pros: 'Hands-on codebase access from day one, weekly 1:1s with senior architects, stipend paid on 1st of month.',
        cons: 'Occasional sprint crunch during releases, documentation can be improved.',
        adviceToManagement: 'Continue investing in intern onboarding documentation.',
        isAnonymous: false
    });

    assert.equal(review.company.toString(), companyId.toString());
    assert.equal(review.candidate.toString(), candidateId.toString());
    assert.equal(review.internship.toString(), internshipId.toString());
    assert.equal(review.roleTitle, 'Frontend Engineering Intern');
    assert.equal(review.rating, 5);
    assert.equal(review.mentorshipRating, 4);
    assert.equal(review.learningCurveRating, 5);
    assert.equal(review.stipendPunctualityRating, 4);
    assert.equal(review.workLifeBalanceRating, 4);
    assert.equal(review.title, 'Outstanding learning curve and supportive mentors');
    assert.equal(review.isAnonymous, false);
    assert.equal(review.status, 'Published');
    assert.deepEqual(review.helpfulVotes, []);
    assert.equal(review.validateSync(), undefined, 'Validation should pass without errors');
});

test('Review schema validates required fields (company, candidate, roleTitle, rating, pros, cons)', () => {
    const invalidReview = new Review({});
    const error = invalidReview.validateSync();
    assert.ok(error, 'Should produce validation errors');
    assert.ok(error.errors.company, 'company is required');
    assert.ok(error.errors.candidate, 'candidate is required');
    assert.ok(error.errors.roleTitle, 'roleTitle is required');
    assert.ok(error.errors.rating, 'rating is required');
    assert.ok(error.errors.pros, 'pros is required');
    assert.ok(error.errors.cons, 'cons is required');
});

test('Review schema enforces 1-5 rating range bounds on all metrics', () => {
    const companyId = new mongoose.Types.ObjectId();
    const candidateId = new mongoose.Types.ObjectId();

    // Below min
    const tooLow = new Review({
        company: companyId,
        candidate: candidateId,
        roleTitle: 'Intern',
        rating: 0,
        mentorshipRating: 0,
        learningCurveRating: 0,
        stipendPunctualityRating: 0,
        workLifeBalanceRating: 0,
        pros: 'Good',
        cons: 'None'
    });
    const errorLow = tooLow.validateSync();
    assert.ok(errorLow.errors.rating, 'Rating < 1 should fail');
    assert.ok(errorLow.errors.mentorshipRating, 'Mentorship < 1 should fail');

    // Above max
    const tooHigh = new Review({
        company: companyId,
        candidate: candidateId,
        roleTitle: 'Intern',
        rating: 6,
        mentorshipRating: 6,
        pros: 'Good',
        cons: 'None'
    });
    const errorHigh = tooHigh.validateSync();
    assert.ok(errorHigh.errors.rating, 'Rating > 5 should fail');
    assert.ok(errorHigh.errors.mentorshipRating, 'Mentorship > 5 should fail');
});

test('Review schema defines unique composite index on { company: 1, candidate: 1 }', () => {
    const indexes = Review.schema.indexes();
    const hasCompositeUnique = indexes.some(idx => {
        const fields = idx[0];
        const options = idx[1] || {};
        return fields.company === 1 && fields.candidate === 1 && options.unique === true;
    });
    assert.ok(hasCompositeUnique, 'Must enforce one review per company per candidate with composite unique index');
});

test('Review schema supports employer response subdocument', () => {
    const recruiterId = new mongoose.Types.ObjectId();
    const review = new Review({
        company: new mongoose.Types.ObjectId(),
        candidate: new mongoose.Types.ObjectId(),
        roleTitle: 'Data Analyst Intern',
        rating: 4,
        pros: 'Great datasets',
        cons: 'Compute quota limits',
        employerResponse: {
            comment: 'Thank you for the constructive feedback! We increased GPU cluster quotas for all interns.',
            respondedAt: new Date('2026-03-01'),
            respondedBy: recruiterId
        }
    });

    assert.equal(review.employerResponse.comment, 'Thank you for the constructive feedback! We increased GPU cluster quotas for all interns.');
    assert.equal(review.employerResponse.respondedBy.toString(), recruiterId.toString());
});

// ---------------------------------------------------------------------------
// 2. Review Utilities & Analytics Tests (utils/reviews.js)
// ---------------------------------------------------------------------------

test('calculateCompanyReviewStats returns zero-state defaults when no reviews exist', async t => {
    const originalFind = Review.find;
    t.after(() => { Review.find = originalFind; });

    // Mock empty reviews array
    Review.find = () => ({
        lean: async () => []
    });

    const companyId = new mongoose.Types.ObjectId();
    const stats = await calculateCompanyReviewStats(companyId);

    assert.equal(stats.totalReviews, 0);
    assert.equal(stats.averageRating, 0);
    assert.equal(stats.mentorshipAvg, 0);
    assert.equal(stats.learningAvg, 0);
    assert.equal(stats.stipendAvg, 0);
    assert.equal(stats.workLifeAvg, 0);
    assert.equal(stats.recommendRate, 0);
    assert.equal(stats.ratingDistribution['5'], 0);
});

test('calculateCompanyReviewStats computes accurate multi-metric averages, percentages, and star distribution', async t => {
    const originalFind = Review.find;
    t.after(() => { Review.find = originalFind; });

    const mockReviews = [
        {
            rating: 5,
            mentorshipRating: 5,
            learningCurveRating: 4,
            stipendPunctualityRating: 5,
            workLifeBalanceRating: 4
        },
        {
            rating: 4,
            mentorshipRating: 4,
            learningCurveRating: 5,
            stipendPunctualityRating: 4,
            workLifeBalanceRating: 3
        },
        {
            rating: 3,
            mentorshipRating: 3,
            learningCurveRating: 3,
            stipendPunctualityRating: 3,
            workLifeBalanceRating: 2
        }
    ];

    Review.find = () => ({
        lean: async () => mockReviews
    });

    const companyId = new mongoose.Types.ObjectId();
    const stats = await calculateCompanyReviewStats(companyId);

    assert.equal(stats.totalReviews, 3);
    // (5 + 4 + 3) / 3 = 4.0
    assert.equal(stats.averageRating, 4.0);
    // (5 + 4 + 3) / 3 = 4.0
    assert.equal(stats.mentorshipAvg, 4.0);
    // (4 + 5 + 3) / 3 = 4.0
    assert.equal(stats.learningAvg, 4.0);
    // (5 + 4 + 3) / 3 = 4.0
    assert.equal(stats.stipendAvg, 4.0);
    // (4 + 3 + 2) / 3 = 3.0
    assert.equal(stats.workLifeAvg, 3.0);
    // 2 out of 3 reviews are >= 4 stars -> 67%
    assert.equal(stats.recommendRate, 67);
    // Star counts
    assert.equal(stats.ratingDistribution['5'], 1);
    assert.equal(stats.ratingDistribution['4'], 1);
    assert.equal(stats.ratingDistribution['3'], 1);
    assert.equal(stats.ratingDistribution['2'], 0);
    assert.equal(stats.ratingDistribution['1'], 0);
    // Percentages: 1/3 ~ 33%
    assert.equal(stats.distributionPercentages['5'], 33);
    assert.equal(stats.distributionPercentages['4'], 33);
});

test('checkReviewEligibility verifies candidate completed/accepted internship status', async t => {
    const Application = require('../models/Application');
    const Certificate = require('../models/Certificate');
    const Internship = require('../models/Internship');

    const originalAppFindOne = Application.findOne;
    const originalCertFindOne = Certificate.findOne;
    const originalReviewFindOne = Review.findOne;
    const originalInternshipFind = Internship.find;

    t.after(() => {
        Application.findOne = originalAppFindOne;
        Certificate.findOne = originalCertFindOne;
        Review.findOne = originalReviewFindOne;
        Internship.find = originalInternshipFind;
    });

    const candidateId = new mongoose.Types.ObjectId();
    const companyId = new mongoose.Types.ObjectId();
    const internshipId = new mongoose.Types.ObjectId();

    // 1. Candidate is not eligible if no accepted application or certificate exists
    Application.findOne = () => null;
    Certificate.findOne = () => null;
    Review.findOne = () => null;
    Internship.find = () => ({
        select: () => ({
            lean: async () => []
        })
    });

    const notEligible = await checkReviewEligibility(candidateId, companyId);
    assert.equal(notEligible.isEligible, false);
    assert.equal(notEligible.reason, 'unverified');

    // 2. Candidate is eligible if they have a 'Hired' or 'Accepted' application
    Application.findOne = () => ({
        populate: async () => ({
            _id: new mongoose.Types.ObjectId(),
            candidate: candidateId,
            company: companyId,
            internship: { _id: internshipId, title: 'AI Research Intern' },
            status: 'Hired'
        })
    });

    const eligibleHired = await checkReviewEligibility(candidateId, companyId);
    assert.equal(eligibleHired.isEligible, true);
    assert.equal(eligibleHired.verifiedVia, 'application');
    assert.ok(eligibleHired.matchedInternship);

    // 3. Existing review detection
    Review.findOne = () => ({
        lean: async () => ({ _id: new mongoose.Types.ObjectId(), rating: 5 })
    });
    const alreadyReviewed = await checkReviewEligibility(candidateId, companyId);
    assert.equal(alreadyReviewed.isEligible, true);
    assert.ok(alreadyReviewed.existingReview, 'Detects existing review document');
});

// ---------------------------------------------------------------------------
// 3. Review Routes Registration Tests (routes/reviews.js)
// ---------------------------------------------------------------------------

test('reviews router exposes all required verified review endpoints', () => {
    const expected = [
        ['get', '/companies/:id/reviews'],
        ['get', '/companies/:id/reviews/new'],
        ['post', '/companies/:id/reviews'],
        ['post', '/company/reviews/:reviewId/response'],
        ['post', '/reviews/:reviewId/helpful'],
        ['get', '/api/companies/:id/reviews/stats']
    ];

    expected.forEach(([method, pathPattern]) => {
        const layer = findRouteLayer(reviewsRouter, pathPattern, method);
        assert.ok(layer, `${method.toUpperCase()} ${pathPattern} is registered on reviews router`);
    });
});

test('review submission routes enforce authentication', () => {
    const newFormLayer = findRouteLayer(reviewsRouter, '/companies/:id/reviews/new', 'get');
    assert.ok(newFormLayer);
    const hasAuth = newFormLayer.route.stack.some(s => s.handle.name === 'isAuthenticated');
    assert.ok(hasAuth, 'GET /companies/:id/reviews/new must require authentication');

    const postLayer = findRouteLayer(reviewsRouter, '/companies/:id/reviews', 'post');
    assert.ok(postLayer);
    const hasPostAuth = postLayer.route.stack.some(s => s.handle.name === 'isAuthenticated');
    assert.ok(hasPostAuth, 'POST /companies/:id/reviews must require authentication');
});

// ---------------------------------------------------------------------------
// 4. View Templates Rendering Tests
// ---------------------------------------------------------------------------

test('submit-review.ejs renders rating inputs, sliders, pros/cons, and anonymous toggle', () => {
    const templatePath = path.join(__dirname, '..', 'views', 'company', 'submit-review.ejs');
    const templateContent = fs.readFileSync(templatePath, 'utf8')
        .replace("<% layout('layouts/boilerplate') %>", "");

    const companyId = new mongoose.Types.ObjectId();
    const internshipId = new mongoose.Types.ObjectId();

    const html = ejs.render(templateContent, {
        company: { _id: companyId, name: 'InnovateTech Labs' },
        companyDetails: { companyName: 'InnovateTech Labs', logo: '' },
        cName: 'InnovateTech Labs',
        eligibility: {
            isEligible: true,
            matchedInternship: { _id: internshipId, title: 'Cloud Backend Intern' }
        },
        existingReview: null
    });

    assert.ok(html.includes(`action="/companies/${companyId}/reviews"`), 'Form action points to submission endpoint');
    assert.ok(html.includes('name="rating"'), 'Includes overall star rating input');
    assert.ok(html.includes('name="mentorshipRating"'), 'Includes mentorship rating slider');
    assert.ok(html.includes('name="learningRating"') || html.includes('name="learningCurveRating"'), 'Includes learning curve slider');
    assert.ok(html.includes('name="stipendPunctualityRating"'), 'Includes stipend punctuality slider');
    assert.ok(html.includes('name="workLifeBalanceRating"'), 'Includes work-life balance slider');
    assert.ok(html.includes('name="title"'), 'Includes review headline title');
    assert.ok(html.includes('name="pros"'), 'Includes pros textarea');
    assert.ok(html.includes('name="cons"'), 'Includes cons textarea');
    assert.ok(html.includes('name="adviceToManagement"'), 'Includes advice to management textarea');
    assert.ok(html.includes('name="isAnonymous"'), 'Includes anonymous checkbox toggle');
    assert.ok(html.includes('Verified Internship Engagement'), 'Highlights verified status banner');
});

test('reviews-list.ejs renders aggregate scorecard, aspect averages, and review cards', () => {
    const templatePath = path.join(__dirname, '..', 'views', 'company', 'reviews-list.ejs');
    const templateContent = fs.readFileSync(templatePath, 'utf8')
        .replace("<% layout('layouts/boilerplate') %>", "");

    const companyId = new mongoose.Types.ObjectId();
    const candidateId = new mongoose.Types.ObjectId();

    const mockStats = {
        totalReviews: 2,
        averageRating: 4.5,
        recommendRate: 100,
        mentorshipAvg: 4.8,
        learningAvg: 4.5,
        stipendAvg: 4.0,
        workLifeAvg: 4.2,
        distribution: { '5': 1, '4': 1, '3': 0, '2': 0, '1': 0 },
        ratingDistribution: { '5': 1, '4': 1, '3': 0, '2': 0, '1': 0 },
        distributionPercentages: { '5': 50, '4': 50, '3': 0, '2': 0, '1': 0 }
    };

    const mockReviews = [
        {
            _id: new mongoose.Types.ObjectId(),
            rating: 5,
            title: 'Unbelievable mentorship and steep learning curve',
            roleTitle: 'Fullstack Intern',
            pros: 'Pair programming with lead engineer, learned Kubernetes & GraphQL.',
            cons: 'Fast-paced environment can feel intense at first.',
            adviceToManagement: 'Keep onboarding buddy system.',
            isAnonymous: true,
            candidate: { _id: candidateId, name: 'Secret Candidate' },
            helpfulVotes: [new mongoose.Types.ObjectId()],
            createdAt: new Date('2026-02-15'),
            employerResponse: {
                comment: 'We appreciate having you on the team!',
                respondedAt: new Date('2026-02-16')
            }
        }
    ];

    const html = ejs.render(templateContent, {
        company: { _id: companyId, name: 'Zenith Software' },
        companyDetails: { companyName: 'Zenith Software', logo: '', isVerified: true },
        cName: 'Zenith Software',
        stats: mockStats,
        reviews: mockReviews,
        activeRatingFilter: null,
        activeSort: 'newest',
        eligibility: { isEligible: false },
        currentUser: null,
        isCompanyOwnerOrRecruiter: false
    });

    assert.ok(html.includes('4.5'), 'Renders average rating');
    assert.ok(html.includes('100% of interns recommend'), 'Renders recommendation rate');
    assert.ok(html.includes('Mentorship Quality'), 'Renders Mentorship aspect label');
    assert.ok(html.includes('4.8'), 'Renders Mentorship score');
    assert.ok(html.includes('Unbelievable mentorship and steep learning curve'), 'Renders review title');
    assert.ok(html.includes('Verified Intern'), 'Masks candidate name when anonymous');
    assert.ok(!html.includes('Secret Candidate'), 'Does NOT leak anonymous candidate real name');
    assert.ok(html.includes('Employer Response'), 'Displays official employer response');
    assert.ok(html.includes('We appreciate having you on the team!'), 'Renders employer response content');
});

test('public-profile.ejs renders verified rating badge and culture insights section', () => {
    const templatePath = path.join(__dirname, '..', 'views', 'company', 'public-profile.ejs');
    const templateContent = fs.readFileSync(templatePath, 'utf8')
        .replace("<% layout('layouts/boilerplate') %>", "");

    const companyId = new mongoose.Types.ObjectId();

    const mockStats = {
        totalReviews: 4,
        averageRating: 4.8,
        recommendRate: 100,
        mentorshipAvg: 4.9,
        learningAvg: 4.7,
        stipendAvg: 5.0,
        workLifeAvg: 4.6
    };

    const html = ejs.render(templateContent, {
        company: { _id: companyId, name: 'Nova Cloud' },
        companyDetails: { companyName: 'Nova Cloud', isVerified: true },
        internships: [],
        reviewStats: mockStats,
        reviews: [],
        eligibility: { isEligible: true, existingReview: null },
        currentUser: { role: 'candidate' },
        isCompanyOwnerOrRecruiter: false
    });

    assert.ok(html.includes('4.8'), 'Renders average rating badge');
    assert.ok(html.includes('Verified Intern Reviews &amp; Culture Insights') || html.includes('Verified Intern Reviews & Culture Insights'), 'Renders reviews section title');
    assert.ok(html.includes('href="/companies/' + companyId + '/reviews/new"'), 'Renders Write a Review button when eligible');
    assert.ok(html.includes('Mentorship'), 'Displays mentorship card in scorecard');
});

test('internship-detail.ejs renders verified company rating badge', () => {
    const templatePath = path.join(__dirname, '..', 'views', 'extras', 'internship-detail.ejs');
    const templateContent = fs.readFileSync(templatePath, 'utf8')
        .replace("<% layout('layouts/boilerplate') %>", "");

    const companyId = new mongoose.Types.ObjectId();
    const internshipId = new mongoose.Types.ObjectId();

    const mockStats = {
        totalReviews: 3,
        averageRating: 4.7
    };

    const html = ejs.render(templateContent, {
        internship: {
            _id: internshipId,
            title: 'Systems Engineering Intern',
            company: {
                _id: companyId,
                name: 'HyperDrive Systems',
                companyDetails: { isVerified: true }
            },
            monthlyStipend: 18000,
            duration: '6 Months',
            location: { district: 'Pune', state: 'Maharashtra' },
            requiredSkills: ['C++', 'Rust'],
            overview: 'Core systems team'
        },
        reviewStats: mockStats,
        currentUser: null,
        isPaused: false,
        hasApplied: false,
        isApplied: false,
        isCompanyOwnerOrRecruiter: false,
        isSaved: false
    });

    assert.ok(html.includes('4.7'), 'Renders review average rating next to company');
    assert.ok(html.includes('/companies/' + companyId + '/reviews'), 'Links to company verified reviews page');
});
