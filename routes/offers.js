const express = require('express');
const mongoose = require('mongoose');

const Offer = require('../models/Offer');
const Application = require('../models/Application');
const Internship = require('../models/Internship');
const { isAuthenticated, authorize } = require('../middleware/auth');
const { requireCompanyPermission, belongsToCompany } = require('../middleware/companyAccess');
const {
    ELIGIBLE_APPLICATION_STATUSES,
    OfferLifecycleError,
    parseOfferInput,
    expireOfferIfDue,
    acceptOffer,
    declineOffer,
    notifyOfferIssued,
    notifyOfferAccepted,
    notifyOfferDeclined
} = require('../utils/offers');

const router = express.Router();

function wantsJson(req) {
    return Boolean(req.xhr || req.is('json') || req.headers.accept?.includes('application/json'));
}

function candidateId(req) {
    return req.user?._id || req.user?.id;
}

function sendError(req, res, error, fallbackPath) {
    const status = error.statusCode || 400;
    const message = error.message || 'Unable to process this offer.';
    if (wantsJson(req)) return res.status(status).json({ success: false, error: message, code: error.code });
    if (req.flash) req.flash('error_msg', message);
    return res.redirect(fallbackPath);
}

// Company/recruiter issue an offer. Hired remains intentionally absent from
// the general status endpoint: only a candidate acceptance reaches it.
router.post('/company/applications/:id/offers', isAuthenticated, requireCompanyPermission('applications:review'), async (req, res) => {
    const fallbackPath = `/company/applications/${req.params.id}/candidate`;
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            throw new OfferLifecycleError('Application not found.', 'APPLICATION_NOT_FOUND', 404);
        }

        const application = await Application.findById(req.params.id)
            .populate('candidate')
            .populate('internship');
        if (!application || !application.candidate || !application.internship || !belongsToCompany(application.internship, req.company)) {
            throw new OfferLifecycleError('Application not found.', 'APPLICATION_NOT_FOUND', 404);
        }
        if (!ELIGIBLE_APPLICATION_STATUSES.includes(application.status)) {
            throw new OfferLifecycleError('Offers may only be issued for shortlisted or interview-stage applications.', 'APPLICATION_INELIGIBLE');
        }
        if (application.internship.status !== 'published' || application.internship.isPaused) {
            throw new OfferLifecycleError('Offers can only be issued while the internship listing is open.', 'LISTING_UNAVAILABLE');
        }

        const existing = await Offer.findOne({ application: application._id, isActive: true }).select('_id status expiresAt');
        if (existing) {
            const expired = await expireOfferIfDue(existing, { notify: true });
            if (!expired) throw new OfferLifecycleError('This application already has an active offer.', 'ACTIVE_OFFER_EXISTS', 409);
        }

        const now = new Date();
        const { expiresAt, terms } = parseOfferInput(req.body, application.internship, now);
        const offer = await Offer.create({
            application: application._id,
            internship: application.internship._id,
            candidate: application.candidate._id,
            company: req.company._id,
            issuedBy: req.user._id,
            expiresAt,
            terms,
            events: [{ action: 'issued', actor: req.user._id, actorRole: 'company', at: now }]
        });

        // Keep a human-readable audit marker beside the status timeline. The
        // Offer remains the authoritative terms and decision record.
        await Application.updateOne(
            { _id: application._id },
            { $push: { notes: { text: `[OFFER] Offer issued; expires ${expiresAt.toISOString()}.`, createdBy: req.user._id, createdAt: now } } }
        );

        try {
            await notifyOfferIssued(offer, application.internship);
        } catch (notificationError) {
            console.error('Failed to notify candidate about offer issuance:', notificationError);
        }

        if (wantsJson(req)) return res.status(201).json({ success: true, offer });
        if (req.flash) req.flash('success_msg', 'Offer issued. The candidate has been notified.');
        return res.redirect(fallbackPath);
    } catch (error) {
        if (error && error.code === 11000) {
            return sendError(req, res, new OfferLifecycleError('This application already has an active offer.', 'ACTIVE_OFFER_EXISTS', 409), fallbackPath);
        }
        console.error('Error issuing offer:', error);
        return sendError(req, res, error, fallbackPath);
    }
});

// Candidate's dedicated offer page. Looking at an expired offer lazily marks
// it expired, so stale offers cannot remain actionable between scheduler runs.
router.get('/candidate/offers/:id', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            throw new OfferLifecycleError('Offer not found.', 'OFFER_NOT_FOUND', 404);
        }
        let offer = await Offer.findOne({ _id: req.params.id, candidate: candidateId(req) })
            .populate('internship')
            .populate('application')
            .populate('company', 'name companyDetails.companyName');
        if (!offer) throw new OfferLifecycleError('Offer not found.', 'OFFER_NOT_FOUND', 404);

        const expired = await expireOfferIfDue(offer, { notify: true });
        if (expired) offer = Object.assign(offer, expired.toObject ? expired.toObject() : expired);

        return res.render('candidate/offer', { offer, currentUser: req.user });
    } catch (error) {
        console.error('Error loading offer:', error);
        return sendError(req, res, error, '/candidate/applications');
    }
});

router.post('/candidate/offers/:id/accept', isAuthenticated, authorize('candidate'), async (req, res) => {
    const fallbackPath = `/candidate/offers/${req.params.id}`;
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            throw new OfferLifecycleError('Offer not found.', 'OFFER_NOT_FOUND', 404);
        }
        const result = await acceptOffer({ offerId: req.params.id, candidateId: candidateId(req) });
        try {
            await notifyOfferAccepted(result.offer, result.internship);
        } catch (notificationError) {
            console.error('Failed to notify company about accepted offer:', notificationError);
        }

        const message = result.listingClosed
            ? 'Offer accepted. All seats are now filled, so the listing has closed.'
            : 'Offer accepted. Your application is now marked as hired.';
        if (wantsJson(req)) return res.json({ success: true, message, offer: result.offer, application: result.application });
        if (req.flash) req.flash('success_msg', message);
        return res.redirect('/candidate/applications');
    } catch (error) {
        console.error('Error accepting offer:', error);
        return sendError(req, res, error, fallbackPath);
    }
});

router.post('/candidate/offers/:id/decline', isAuthenticated, authorize('candidate'), async (req, res) => {
    const fallbackPath = `/candidate/offers/${req.params.id}`;
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            throw new OfferLifecycleError('Offer not found.', 'OFFER_NOT_FOUND', 404);
        }
        const offer = await declineOffer({
            offerId: req.params.id,
            candidateId: candidateId(req),
            reason: typeof req.body?.reason === 'string' ? req.body.reason : ''
        });
        const internship = await Internship.findById(offer.internship);
        if (internship) {
            try {
                await notifyOfferDeclined(offer, internship);
            } catch (notificationError) {
                console.error('Failed to notify company about declined offer:', notificationError);
            }
        }

        if (wantsJson(req)) return res.json({ success: true, offer });
        if (req.flash) req.flash('success_msg', 'Offer declined. The company has been notified.');
        return res.redirect('/candidate/applications');
    } catch (error) {
        console.error('Error declining offer:', error);
        return sendError(req, res, error, fallbackPath);
    }
});

module.exports = router;
