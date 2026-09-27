const Offer = require('../models/Offer');
const Application = require('../models/Application');
const Internship = require('../models/Internship');
const Notification = require('../models/Notification');

const ELIGIBLE_APPLICATION_STATUSES = ['Shortlisted', 'Interview'];
const DECLINED_APPLICATION_STATUS = 'Offer Declined';

class OfferLifecycleError extends Error {
    constructor(message, code = 'OFFER_LIFECYCLE_ERROR', statusCode = 400) {
        super(message);
        this.name = 'OfferLifecycleError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function asId(value) {
    return value && value._id ? value._id : value;
}

function sameId(left, right) {
    return String(asId(left) || '') === String(asId(right) || '');
}

function offerEvent(action, actor, actorRole, at, reason = '') {
    return {
        action,
        actor: actor || undefined,
        actorRole,
        at,
        reason: typeof reason === 'string' ? reason.trim().slice(0, 500) : ''
    };
}

function parseOptionalDate(value, name) {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string' && !(value instanceof Date)) {
        throw new OfferLifecycleError(`${name} must be a valid date.`);
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new OfferLifecycleError(`${name} must be a valid date.`);
    return date;
}

function parseOfferInput(body = {}, listing = {}, now = new Date()) {
    const expiresAt = parseOptionalDate(body.expiresAt, 'Offer expiry');
    if (!expiresAt || expiresAt <= now) {
        throw new OfferLifecycleError('Offer expiry must be a future date and time.');
    }

    const startDate = parseOptionalDate(body.startDate, 'Start date');
    const rawStipend = body.monthlyStipend === undefined || body.monthlyStipend === ''
        ? listing.monthlyStipend
        : Number(body.monthlyStipend);
    const monthlyStipend = Number(rawStipend);
    if (!Number.isFinite(monthlyStipend) || monthlyStipend < 0) {
        throw new OfferLifecycleError('Monthly stipend must be a non-negative number.');
    }

    const duration = typeof body.duration === 'string' && body.duration.trim()
        ? body.duration.trim().slice(0, 120)
        : String(listing.duration || '').trim().slice(0, 120);
    const additionalTerms = typeof body.additionalTerms === 'string'
        ? body.additionalTerms.trim().slice(0, 2000)
        : '';

    return {
        expiresAt,
        terms: { startDate, monthlyStipend, duration, additionalTerms }
    };
}

function buildStatusTransition(status, offerId, now, actor, note) {
    return {
        $set: {
            status,
            statusUpdatedAt: now,
            placement: {
                offer: offerId,
                outcome: status === 'Hired' ? 'accepted' : 'declined',
                decidedAt: now
            }
        },
        $push: {
            statusHistory: { status, changedAt: now, offer: offerId },
            notes: { text: note, createdBy: actor, createdAt: now }
        }
    };
}

function seatReservationFilter(internshipId) {
    return {
        _id: internshipId,
        status: 'published',
        isPaused: { $ne: true },
        $expr: {
            $lt: [
                { $ifNull: ['$filledSeats', 0] },
                { $ifNull: ['$vacancies', 1] }
            ]
        }
    };
}

async function reserveSeat(InternshipModel, internshipId) {
    const internship = await InternshipModel.findOneAndUpdate(
        seatReservationFilter(internshipId),
        { $inc: { filledSeats: 1 } },
        { new: true }
    );

    if (!internship) return { reserved: false, internship: null, closed: false };

    const vacancies = Number(internship.vacancies) > 0 ? Number(internship.vacancies) : 1;
    const filledSeats = Number(internship.filledSeats || 0);
    const closed = vacancies > 0 && filledSeats >= vacancies;
    if (closed) {
        await InternshipModel.updateOne(
            { _id: internship._id, filledSeats: { $gte: vacancies } },
            { $set: { status: 'closed', isPaused: false, closedReason: 'capacity' } }
        );
        internship.status = 'closed';
        internship.isPaused = false;
        internship.closedReason = 'capacity';
    }

    return { reserved: true, internship, closed };
}

async function releaseSeat(InternshipModel, internshipId) {
    const internship = await InternshipModel.findOneAndUpdate(
        { _id: internshipId, filledSeats: { $gt: 0 } },
        { $inc: { filledSeats: -1 } },
        { new: true }
    );
    if (!internship) return null;

    const vacancies = Number(internship.vacancies) > 0 ? Number(internship.vacancies) : 1;
    if (internship.status === 'closed' && internship.closedReason === 'capacity' && Number(internship.filledSeats || 0) < vacancies) {
        await InternshipModel.updateOne(
            { _id: internship._id, status: 'closed', closedReason: 'capacity', filledSeats: { $lt: vacancies } },
            { $set: { status: 'published', isPaused: false, closedReason: null } }
        );
        internship.status = 'published';
        internship.isPaused = false;
        internship.closedReason = null;
    }
    return internship;
}

async function releaseSeatIfHeld(offer, { OfferModel = Offer, InternshipModel = Internship } = {}) {
    if (!offer || !offer.seatReserved) return false;
    await releaseSeat(InternshipModel, offer.internship);
    await OfferModel.updateOne(
        { _id: offer._id, seatReserved: true },
        { $set: { seatReserved: false, seatReservedAt: null } }
    );
    return true;
}

async function expireOfferIfDue(offer, {
    now = new Date(),
    OfferModel = Offer,
    InternshipModel = Internship,
    NotificationModel = Notification,
    notify = false
} = {}) {
    if (!offer || offer.status !== 'issued' || !offer.expiresAt || new Date(offer.expiresAt) > now) {
        return null;
    }

    const expired = await OfferModel.findOneAndUpdate(
        { _id: offer._id, status: 'issued', isActive: true, expiresAt: { $lte: now } },
        {
            $set: { status: 'expired', isActive: false, expiredAt: now },
            $push: { events: offerEvent('expired', null, 'system', now) }
        },
        { new: true }
    );
    if (!expired) return null;

    await releaseSeatIfHeld(expired, { OfferModel, InternshipModel });
    if (notify && typeof InternshipModel.findById === 'function') {
        const internship = await InternshipModel.findById(expired.internship);
        if (internship) await notifyOfferExpired(expired, internship, NotificationModel);
    }
    return expired;
}

async function acceptOffer({
    offerId,
    candidateId,
    now = new Date(),
    OfferModel = Offer,
    ApplicationModel = Application,
    InternshipModel = Internship
}) {
    const offer = await OfferModel.findOneAndUpdate(
        {
            _id: offerId,
            candidate: candidateId,
            status: 'issued',
            isActive: true,
            expiresAt: { $gt: now }
        },
        { $set: { status: 'accepting', acceptanceStartedAt: now } },
        { new: true }
    );

    if (!offer) {
        const existing = await OfferModel.findOne({ _id: offerId, candidate: candidateId });
        if (existing && existing.status === 'issued') {
            const expired = await expireOfferIfDue(existing, { now, OfferModel, InternshipModel, notify: true });
            if (expired) {
                throw new OfferLifecycleError('This offer has expired.', 'OFFER_EXPIRED', 410);
            }
        }
        throw new OfferLifecycleError('This offer is no longer available to accept.', 'OFFER_UNAVAILABLE', 409);
    }

    const application = await ApplicationModel.findOne({
        _id: offer.application,
        candidate: candidateId,
        status: { $in: ELIGIBLE_APPLICATION_STATUSES }
    });
    if (!application || !sameId(application.internship, offer.internship)) {
        await OfferModel.findOneAndUpdate(
            { _id: offer._id, status: 'accepting' },
            {
                $set: { status: 'revoked', isActive: false, revokedAt: now },
                $push: { events: offerEvent('revoked', null, 'system', now, 'Application is no longer eligible.') }
            },
            { new: true }
        );
        throw new OfferLifecycleError('This application is no longer eligible for the offer.', 'APPLICATION_INELIGIBLE', 409);
    }

    const reservation = await reserveSeat(InternshipModel, offer.internship);
    if (!reservation.reserved) {
        await OfferModel.updateOne(
            { _id: offer._id, status: 'accepting' },
            { $set: { status: 'issued', acceptanceStartedAt: null } }
        );
        throw new OfferLifecycleError('No seats remain for this internship. The offer is still open while the company resolves availability.', 'NO_SEATS_AVAILABLE', 409);
    }

    const updatedApplication = await ApplicationModel.findOneAndUpdate(
        {
            _id: offer.application,
            candidate: candidateId,
            status: { $in: ELIGIBLE_APPLICATION_STATUSES }
        },
        buildStatusTransition('Hired', offer._id, now, candidateId, '[OFFER] Candidate accepted the offer.'),
        { new: true }
    );

    if (!updatedApplication) {
        await releaseSeat(InternshipModel, offer.internship);
        await OfferModel.findOneAndUpdate(
            { _id: offer._id, status: 'accepting' },
            {
                $set: { status: 'revoked', isActive: false, revokedAt: now },
                $push: { events: offerEvent('revoked', null, 'system', now, 'Application changed during acceptance.') }
            },
            { new: true }
        );
        throw new OfferLifecycleError('The application changed before the offer could be accepted.', 'APPLICATION_CHANGED', 409);
    }

    const accepted = await OfferModel.findOneAndUpdate(
        { _id: offer._id, status: 'accepting' },
        {
            $set: {
                status: 'accepted',
                isActive: false,
                acceptedAt: now,
                seatReserved: true,
                seatReservedAt: now
            },
            $push: { events: offerEvent('accepted', candidateId, 'candidate', now) }
        },
        { new: true }
    );

    if (!accepted) {
        throw new OfferLifecycleError('The offer could not be finalised. Please contact support.', 'OFFER_FINALISATION_FAILED', 500);
    }

    return { offer: accepted, application: updatedApplication, internship: reservation.internship, listingClosed: reservation.closed };
}

async function declineOffer({
    offerId,
    candidateId,
    reason = '',
    now = new Date(),
    OfferModel = Offer,
    ApplicationModel = Application,
    InternshipModel = Internship
}) {
    const offer = await OfferModel.findOneAndUpdate(
        {
            _id: offerId,
            candidate: candidateId,
            status: 'issued',
            isActive: true,
            expiresAt: { $gt: now }
        },
        {
            $set: {
                status: 'declined',
                isActive: false,
                declinedAt: now,
                declineReason: typeof reason === 'string' ? reason.trim().slice(0, 500) : ''
            },
            $push: { events: offerEvent('declined', candidateId, 'candidate', now, reason) }
        },
        { new: true }
    );

    if (!offer) {
        const existing = await OfferModel.findOne({ _id: offerId, candidate: candidateId });
        if (existing && existing.status === 'issued') {
            const expired = await expireOfferIfDue(existing, { now, OfferModel, InternshipModel, notify: true });
            if (expired) throw new OfferLifecycleError('This offer has expired.', 'OFFER_EXPIRED', 410);
        }
        throw new OfferLifecycleError('This offer is no longer available to decline.', 'OFFER_UNAVAILABLE', 409);
    }

    await ApplicationModel.findOneAndUpdate(
        {
            _id: offer.application,
            candidate: candidateId,
            status: { $in: ELIGIBLE_APPLICATION_STATUSES }
        },
        buildStatusTransition(DECLINED_APPLICATION_STATUS, offer._id, now, candidateId, '[OFFER] Candidate declined the offer.'),
        { new: true }
    );
    await releaseSeatIfHeld(offer, { OfferModel, InternshipModel });

    return offer;
}

async function expireDueOffers({
    now = new Date(),
    limit = 100,
    OfferModel = Offer,
    InternshipModel = Internship
} = {}) {
    const dueOffers = await OfferModel.find({
        status: 'issued',
        isActive: true,
        expiresAt: { $lte: now }
    }).sort({ expiresAt: 1 }).limit(limit);

    const expired = [];
    for (const offer of dueOffers) {
        const result = await expireOfferIfDue(offer, { now, OfferModel, InternshipModel, notify: true });
        if (result) expired.push(result);
    }
    return expired;
}

async function notifyOfferIssued(offer, internship, NotificationModel = Notification) {
    return NotificationModel.create({
        recipient: offer.candidate,
        type: 'offer_issued',
        title: 'Internship offer received',
        message: `You have received an offer for ${internship.title} at ${internship.companyName}. Respond before ${new Date(offer.expiresAt).toLocaleString('en-IN')}.`,
        link: `/candidate/offers/${offer._id}`,
        internship: offer.internship,
        application: offer.application,
        metadata: { offerId: offer._id }
    });
}

async function notifyOfferAccepted(offer, internship, NotificationModel = Notification) {
    return NotificationModel.create({
        companyId: offer.company,
        type: 'offer_accepted',
        title: 'Offer accepted',
        message: `A candidate accepted the offer for ${internship.title}.`,
        link: `/company/internships/${offer.internship}/applicants`,
        internship: offer.internship,
        application: offer.application,
        metadata: { offerId: offer._id }
    });
}

async function notifyOfferDeclined(offer, internship, NotificationModel = Notification) {
    return NotificationModel.create({
        companyId: offer.company,
        type: 'offer_declined',
        title: 'Offer declined',
        message: `A candidate declined the offer for ${internship.title}.`,
        link: `/company/internships/${offer.internship}/applicants`,
        internship: offer.internship,
        application: offer.application,
        metadata: { offerId: offer._id }
    });
}

async function notifyOfferExpired(offer, internship, NotificationModel = Notification) {
    const candidateNotice = {
        recipient: offer.candidate,
        type: 'offer_expired',
        title: 'Internship offer expired',
        message: `Your offer for ${internship.title} at ${internship.companyName} expired before a response was received.`,
        link: `/candidate/offers/${offer._id}`,
        internship: offer.internship,
        application: offer.application,
        metadata: { offerId: offer._id }
    };
    const companyNotice = {
        companyId: offer.company,
        type: 'offer_expired',
        title: 'Offer expired',
        message: `An offer for ${internship.title} expired without a candidate response.`,
        link: `/company/internships/${offer.internship}/applicants`,
        internship: offer.internship,
        application: offer.application,
        metadata: { offerId: offer._id }
    };
    return Promise.all([NotificationModel.create(candidateNotice), NotificationModel.create(companyNotice)]);
}

module.exports = {
    ELIGIBLE_APPLICATION_STATUSES,
    DECLINED_APPLICATION_STATUS,
    OfferLifecycleError,
    sameId,
    parseOfferInput,
    seatReservationFilter,
    reserveSeat,
    releaseSeat,
    releaseSeatIfHeld,
    expireOfferIfDue,
    expireDueOffers,
    acceptOffer,
    declineOffer,
    notifyOfferIssued,
    notifyOfferAccepted,
    notifyOfferDeclined,
    notifyOfferExpired
};
