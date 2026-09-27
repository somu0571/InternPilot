const mongoose = require('mongoose');
const Review = require('../models/Review');
const Application = require('../models/Application');
const Certificate = require('../models/Certificate');
const Internship = require('../models/Internship');

/**
 * Calculates aggregate review statistics for a given company.
 */
async function calculateCompanyReviewStats(companyId) {
    if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
        return getEmptyReviewStats();
    }

    const objectId = new mongoose.Types.ObjectId(companyId);

    let reviews = [];
    try {
        const query = Review.find({
            company: objectId,
            status: 'Published'
        });
        reviews = typeof query.lean === 'function' ? await query.lean() : await query;
    } catch (e) {
        reviews = [];
    }

    if (!reviews || reviews.length === 0) {
        return getEmptyReviewStats();
    }

    const total = reviews.length;
    let sumRating = 0;
    let sumMentorship = 0;
    let sumLearning = 0;
    let sumStipend = 0;
    let sumWorkLife = 0;
    let positiveCount = 0;

    const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };

    reviews.forEach(r => {
        const ratingVal = r.rating || 0;
        const mentorshipVal = r.mentorshipRating ?? r.mentorship ?? ratingVal;
        const learningVal = r.learningCurveRating ?? r.learningRating ?? r.learning ?? ratingVal;
        const stipendVal = r.stipendPunctualityRating ?? r.stipendRating ?? r.stipend ?? ratingVal;
        const workLifeVal = r.workLifeBalanceRating ?? r.workLifeRating ?? r.workLife ?? ratingVal;

        sumRating += ratingVal;
        sumMentorship += mentorshipVal;
        sumLearning += learningVal;
        sumStipend += stipendVal;
        sumWorkLife += workLifeVal;

        const star = Math.min(5, Math.max(1, Math.round(ratingVal)));
        distribution[star] = (distribution[star] || 0) + 1;

        if (ratingVal >= 4) {
            positiveCount++;
        }
    });

    const averageRating = Number((sumRating / total).toFixed(1));
    const mentorshipAvg = Number((sumMentorship / total).toFixed(1));
    const learningAvg = Number((sumLearning / total).toFixed(1));
    const stipendAvg = Number((sumStipend / total).toFixed(1));
    const workLifeAvg = Number((sumWorkLife / total).toFixed(1));
    const recommendRate = Math.round((positiveCount / total) * 100);

    const distributionPercentages = {
        5: Math.round((distribution[5] / total) * 100),
        4: Math.round((distribution[4] / total) * 100),
        3: Math.round((distribution[3] / total) * 100),
        2: Math.round((distribution[2] / total) * 100),
        1: Math.round((distribution[1] / total) * 100)
    };

    return {
        totalReviews: total,
        averageRating,
        mentorshipAvg,
        learningAvg,
        stipendAvg,
        workLifeAvg,
        recommendRate,
        distribution,
        ratingDistribution: distribution,
        distributionPercentages
    };
}

function getEmptyReviewStats() {
    const emptyDist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    return {
        totalReviews: 0,
        averageRating: 0,
        mentorshipAvg: 0,
        learningAvg: 0,
        stipendAvg: 0,
        workLifeAvg: 0,
        recommendRate: 0,
        distribution: emptyDist,
        ratingDistribution: emptyDist,
        distributionPercentages: emptyDist
    };
}

/**
 * Checks if a candidate is eligible to review a company.
 * Candidate must have been Hired / Accepted or earned a Certificate for a role at the company.
 */
async function checkReviewEligibility(candidateId, companyId) {
    if (!candidateId || !companyId) {
        return { isEligible: false, reason: 'unverified', existingReview: null, application: null, internship: null, roleTitle: 'Intern' };
    }

    const cId = new mongoose.Types.ObjectId(candidateId);
    const compId = new mongoose.Types.ObjectId(companyId);

    // Check if review already exists
    let existingReview = null;
    try {
        const rQuery = Review.findOne({ candidate: cId, company: compId });
        existingReview = typeof rQuery.lean === 'function' ? await rQuery.lean() : await rQuery;
    } catch (e) {
        existingReview = null;
    }

    // 1. Check if candidate has a Certificate issued with this company
    try {
        const certQuery = Certificate.findOne({
            candidate: cId,
            company: compId,
            status: 'Issued'
        });
        const cert = typeof certQuery?.populate === 'function'
            ? await certQuery.populate('internship')
            : await certQuery;

        if (cert) {
            return {
                isEligible: true,
                hasCertificate: true,
                existingReview,
                application: cert.application,
                internship: cert.internship,
                matchedInternship: cert.internship,
                roleTitle: cert.internshipTitle || 'Intern',
                verifiedVia: 'certificate'
            };
        }
    } catch (e) {
        // Ignore and check applications
    }

    // 2. Check directly on Application collection
    try {
        const appQuery = Application.findOne({
            candidate: cId,
            $or: [
                { company: compId },
                { companyId: compId }
            ],
            status: { $in: ['Hired', 'hired', 'Accepted', 'accepted'] }
        });
        const appDirect = typeof appQuery?.populate === 'function'
            ? await appQuery.populate('internship')
            : await appQuery;

        if (appDirect) {
            return {
                isEligible: true,
                hasCertificate: false,
                existingReview,
                application: appDirect._id,
                internship: appDirect.internship,
                matchedInternship: appDirect.internship,
                roleTitle: (appDirect.internship && appDirect.internship.title) ? appDirect.internship.title : 'Intern',
                verifiedVia: 'application'
            };
        }
    } catch (e) {
        // Ignore and check via internship IDs
    }

    // 3. Check applications via company's internships
    try {
        const iQuery = Internship.find({
            $or: [{ companyId: compId }, { postedBy: compId }]
        }).select('_id title');
        const companyInternships = typeof iQuery?.lean === 'function' ? await iQuery.lean() : await iQuery;
        const internshipIds = (companyInternships || []).map(i => i._id);

        if (internshipIds.length > 0) {
            const appQuery2 = Application.findOne({
                candidate: cId,
                internship: { $in: internshipIds },
                status: { $in: ['Hired', 'hired', 'Accepted', 'accepted'] }
            });
            const app = typeof appQuery2?.populate === 'function'
                ? await appQuery2.populate('internship')
                : await appQuery2;

            if (app) {
                return {
                    isEligible: true,
                    hasCertificate: false,
                    existingReview,
                    application: app._id,
                    internship: app.internship,
                    matchedInternship: app.internship,
                    roleTitle: (app.internship && app.internship.title) ? app.internship.title : 'Intern',
                    verifiedVia: 'application'
                };
            }
        }
    } catch (e) {
        // Fall through
    }

    return {
        isEligible: false,
        reason: 'unverified',
        hasCertificate: false,
        existingReview,
        application: null,
        internship: null,
        roleTitle: 'Intern'
    };
}

module.exports = {
    calculateCompanyReviewStats,
    checkReviewEligibility,
    getEmptyReviewStats
};
