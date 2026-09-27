const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Review = require('../models/Review');
const User = require('../models/User');
const Internship = require('../models/Internship');
const Application = require('../models/Application');
const Notification = require('../models/Notification');
const { isAuthenticated } = require('../middleware/auth');
const { companyName } = require('../middleware/companyAccess');
const { calculateCompanyReviewStats, checkReviewEligibility } = require('../utils/reviews');

/**
 * Resolves a company ID to the primary company account.
 */
async function resolveCompany(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    let company = await User.findById(id);
    if (!company) return null;

    if (['recruiter', 'hiring_manager'].includes(company.role) && company.companyId) {
        const parent = await User.findById(company.companyId);
        if (parent) company = parent;
    }

    return company;
}

// ---------------------------------------------------------
// Public Reviews Listing & Workplace Insights
// ---------------------------------------------------------

/**
 * GET /companies/:id/reviews
 * Public view for verified company reviews and rating analytics.
 */
router.get(['/companies/:id/reviews', '/company/:id/reviews'], async (req, res) => {
    try {
        const company = await resolveCompany(req.params.id);
        if (!company) {
            if (req.flash) req.flash('error_msg', 'Company not found.');
            return res.redirect('/internships');
        }

        const stats = await calculateCompanyReviewStats(company._id);

        // Filter and sort parameters
        const ratingFilter = req.query.rating ? parseInt(req.query.rating, 10) : null;
        const sortFilter = req.query.sort || 'newest';

        const query = {
            company: company._id,
            status: 'Published'
        };

        if (ratingFilter && ratingFilter >= 1 && ratingFilter <= 5) {
            query.rating = ratingFilter;
        }

        let sortQuery = { createdAt: -1 };
        if (sortFilter === 'highest') sortQuery = { rating: -1, createdAt: -1 };
        if (sortFilter === 'lowest') sortQuery = { rating: 1, createdAt: -1 };
        if (sortFilter === 'helpful') sortQuery = { 'helpfulVotes.length': -1, createdAt: -1 };

        const reviews = await Review.find(query)
            .populate('candidate', 'name avatar')
            .populate('internship', 'title sector')
            .sort(sortQuery);

        // Check if current user is eligible to write a review
        let eligibility = { isEligible: false, existingReview: null };
        if (req.user && req.user.role === 'candidate') {
            eligibility = await checkReviewEligibility(req.user._id, company._id);
        }

        const isCompanyOwnerOrRecruiter = req.user && (
            req.user.role === 'admin' ||
            (['company', 'recruiter', 'hiring_manager'].includes(req.user.role) &&
             (req.user.companyId || (req.user.role === 'company' ? req.user._id : null)) &&
             (req.user.companyId || req.user._id).toString() === company._id.toString())
        );

        res.render('company/reviews-list', {
            company,
            cName: companyName(company),
            companyDetails: company.companyDetails || {},
            reviews,
            stats,
            eligibility,
            isCompanyOwnerOrRecruiter,
            activeRatingFilter: ratingFilter,
            activeSort: sortFilter,
            currentUser: req.user,
            currentPath: `/companies/${company._id}/reviews`
        });
    } catch (error) {
        console.error('Error fetching company reviews:', error);
        if (req.flash) req.flash('error_msg', 'Failed to load company reviews.');
        res.redirect('/internships');
    }
});

// ---------------------------------------------------------
// Review Submission Routes
// ---------------------------------------------------------

/**
 * GET /companies/:id/reviews/new
 * Review submission form (accessible only to verified interns/candidates).
 */
router.get('/companies/:id/reviews/new', isAuthenticated, async (req, res) => {
    try {
        if (req.user.role !== 'candidate') {
            if (req.flash) req.flash('error_msg', 'Only candidates can submit company reviews.');
            return res.redirect(`/company/${req.params.id}/profile`);
        }

        const company = await resolveCompany(req.params.id);
        if (!company) {
            if (req.flash) req.flash('error_msg', 'Company not found.');
            return res.redirect('/internships');
        }

        const eligibility = await checkReviewEligibility(req.user._id, company._id);

        if (!eligibility.isEligible) {
            if (req.flash) {
                req.flash(
                    'error_msg',
                    'Only verified interns who completed an internship or accepted an offer with this organization can submit reviews.'
                );
            }
            return res.redirect(`/company/${company._id}/profile`);
        }

        if (eligibility.existingReview) {
            if (req.flash) req.flash('info_msg', 'You have already submitted a review for this company.');
            return res.redirect(`/companies/${company._id}/reviews`);
        }

        res.render('company/submit-review', {
            company,
            cName: companyName(company),
            companyDetails: company.companyDetails || {},
            eligibility,
            currentUser: req.user,
            currentPath: `/companies/${company._id}/reviews/new`
        });
    } catch (error) {
        console.error('Error rendering review form:', error);
        if (req.flash) req.flash('error_msg', 'Failed to load review submission form.');
        res.redirect('/internships');
    }
});

/**
 * POST /companies/:id/reviews
 * Creates a verified review for a company.
 */
router.post('/companies/:id/reviews', isAuthenticated, async (req, res) => {
    try {
        if (req.user.role !== 'candidate') {
            if (req.flash) req.flash('error_msg', 'Only candidates can submit company reviews.');
            return res.redirect(`/company/${req.params.id}/profile`);
        }

        const company = await resolveCompany(req.params.id);
        if (!company) {
            if (req.flash) req.flash('error_msg', 'Company not found.');
            return res.redirect('/internships');
        }

        const eligibility = await checkReviewEligibility(req.user._id, company._id);
        if (!eligibility.isEligible) {
            if (req.flash) req.flash('error_msg', 'You are not verified to review this organization.');
            return res.redirect(`/company/${company._id}/profile`);
        }

        if (eligibility.existingReview) {
            if (req.flash) req.flash('error_msg', 'You have already reviewed this organization.');
            return res.redirect(`/companies/${company._id}/reviews`);
        }

        // Parse ratings
        const rating = Math.min(5, Math.max(1, parseInt(req.body.rating, 10) || 5));
        const mentorshipRating = Math.min(5, Math.max(1, parseInt(req.body.mentorshipRating, 10) || 5));
        const learningRating = Math.min(5, Math.max(1, parseInt(req.body.learningRating, 10) || 5));
        const stipendPunctualityRating = Math.min(5, Math.max(1, parseInt(req.body.stipendPunctualityRating, 10) || 5));
        const workLifeBalanceRating = Math.min(5, Math.max(1, parseInt(req.body.workLifeBalanceRating, 10) || 5));

        const title = (req.body.title || '').trim();
        const pros = (req.body.pros || '').trim();
        const cons = (req.body.cons || '').trim();
        const adviceToManagement = (req.body.adviceToManagement || '').trim();
        const isAnonymous = Boolean(req.body.isAnonymous === 'true' || req.body.isAnonymous === 'on' || req.body.isAnonymous === true);
        const employmentStatus = ['Current Intern', 'Former Intern'].includes(req.body.employmentStatus)
            ? req.body.employmentStatus
            : 'Former Intern';

        if (!title || !pros || !cons) {
            if (req.flash) req.flash('error_msg', 'Please fill in the review headline, pros, and cons.');
            return res.redirect(`/companies/${company._id}/reviews/new`);
        }

        const review = new Review({
            company: company._id,
            candidate: req.user._id,
            internship: eligibility.internship?._id || eligibility.internship,
            application: eligibility.application?._id || eligibility.application,
            rating,
            mentorshipRating,
            learningRating,
            stipendPunctualityRating,
            workLifeBalanceRating,
            title,
            pros,
            cons,
            adviceToManagement,
            isAnonymous,
            roleTitle: eligibility.roleTitle || 'Intern',
            employmentStatus,
            status: 'Published'
        });

        await review.save();

        // Dispatch in-app notification to company
        try {
            await Notification.create({
                companyId: company._id,
                type: 'application_status',
                title: 'New Verified Intern Review',
                message: `A verified intern has shared a ${rating}-star review for your company: "${title}".`,
                link: `/companies/${company._id}/reviews`
            });
        } catch (notifErr) {
            console.error('Failed to send review notification to company:', notifErr.message);
        }

        if (req.flash) req.flash('success_msg', 'Your verified review has been published! Thank you for helping the intern community.');
        res.redirect(`/companies/${company._id}/reviews`);
    } catch (error) {
        console.error('Error submitting review:', error);
        if (req.flash) req.flash('error_msg', 'Failed to submit review. Please check your entries and try again.');
        res.redirect(`/companies/${req.params.id}/reviews/new`);
    }
});

// ---------------------------------------------------------
// Employer Response Channel
// ---------------------------------------------------------

/**
 * POST /company/reviews/:reviewId/response
 * Official response from employer to a candidate's review.
 */
router.post('/company/reviews/:reviewId/response', isAuthenticated, async (req, res) => {
    try {
        const { reviewId } = req.params;
        const responseText = (req.body.response || '').trim();

        if (!responseText) {
            if (req.flash) req.flash('error_msg', 'Response message cannot be empty.');
            return res.redirect('back');
        }

        const review = await Review.findById(reviewId);
        if (!review) {
            if (req.flash) req.flash('error_msg', 'Review not found.');
            return res.redirect('back');
        }

        // Verify that the user represents this company
        const companyId = req.user.companyId || (req.user.role === 'company' ? req.user._id : null);
        const isAuthorized = req.user.role === 'admin' || (
            companyId && companyId.toString() === review.company.toString() &&
            ['company', 'recruiter'].includes(req.user.role)
        );

        if (!isAuthorized) {
            if (req.flash) req.flash('error_msg', 'You are not authorized to respond to this review on behalf of the company.');
            return res.redirect('back');
        }

        review.employerResponse = {
            response: responseText,
            respondedAt: new Date(),
            respondedBy: req.user._id
        };

        await review.save();

        if (req.flash) req.flash('success_msg', 'Official employer response published successfully.');
        res.redirect(`/companies/${review.company}/reviews#review-${review._id}`);
    } catch (error) {
        console.error('Error posting employer response:', error);
        if (req.flash) req.flash('error_msg', 'Failed to post employer response.');
        res.redirect('back');
    }
});

// ---------------------------------------------------------
// Helpful Votes & JSON Stats
// ---------------------------------------------------------

/**
 * POST /reviews/:reviewId/helpful
 * Toggles a helpful vote on a review.
 */
router.post('/reviews/:reviewId/helpful', isAuthenticated, async (req, res) => {
    try {
        const review = await Review.findById(req.params.reviewId);
        if (!review) {
            return res.status(404).json({ success: false, message: 'Review not found' });
        }

        const userIdStr = req.user._id.toString();
        const index = review.helpfulVotes.findIndex(id => id.toString() === userIdStr);

        let voted = false;
        if (index === -1) {
            review.helpfulVotes.push(req.user._id);
            voted = true;
        } else {
            review.helpfulVotes.splice(index, 1);
            voted = false;
        }

        await review.save();

        if (req.xhr || req.headers.accept?.includes('json')) {
            return res.json({
                success: true,
                helpfulCount: review.helpfulVotes.length,
                voted
            });
        }

        res.redirect('back');
    } catch (error) {
        console.error('Error toggling helpful vote:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

/**
 * GET /api/companies/:id/reviews/stats
 * Returns company review stats in JSON format.
 */
router.get('/api/companies/:id/reviews/stats', async (req, res) => {
    try {
        const stats = await calculateCompanyReviewStats(req.params.id);
        res.json({ success: true, stats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
