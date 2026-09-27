const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const test = require('node:test');

const Offer = require('../models/Offer');
const Notification = require('../models/Notification');
const {
    DECLINED_APPLICATION_STATUS,
    OfferLifecycleError,
    parseOfferInput,
    reserveSeat,
    acceptOffer,
    declineOffer,
    expireOfferIfDue
} = require('../utils/offers');

const id = () => new mongoose.Types.ObjectId();
const now = new Date('2026-09-27T10:00:00.000Z');

function offerRecord(overrides = {}) {
    return {
        _id: String(id()),
        candidate: String(id()),
        application: String(id()),
        internship: String(id()),
        company: String(id()),
        status: 'issued',
        isActive: true,
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        seatReserved: false,
        events: [],
        ...overrides
    };
}

function offerModelFor(records) {
    const items = new Map(records.map(record => [String(record._id), record]));
    const matches = (record, filter) => {
        if (!record) return false;
        return Object.entries(filter).every(([key, expected]) => {
            if (key === '_id' || key === 'candidate' || key === 'status' || key === 'isActive') {
                return expected && typeof expected === 'object' && '$in' in expected
                    ? expected.$in.includes(record[key])
                    : String(record[key]) === String(expected);
            }
            if (key === 'expiresAt') return !expected.$gt || new Date(record.expiresAt) > expected.$gt;
            return true;
        });
    };
    const apply = (record, update) => {
        Object.assign(record, update.$set || {});
        if (update.$push) {
            Object.entries(update.$push).forEach(([key, value]) => {
                record[key] = Array.isArray(record[key]) ? record[key] : [];
                record[key].push(value);
            });
        }
        return { ...record, events: [...record.events] };
    };

    return {
        items,
        async findOneAndUpdate(filter, update) {
            const record = items.get(String(filter._id));
            return matches(record, filter) ? apply(record, update) : null;
        },
        async findOne(filter) {
            return [...items.values()].find(record => matches(record, filter)) || null;
        },
        async updateOne(filter, update) {
            const record = items.get(String(filter._id));
            if (matches(record, filter)) apply(record, update);
            return { modifiedCount: record ? 1 : 0 };
        }
    };
}

function internshipModelWithSeats(vacancies) {
    const listing = {
        _id: String(id()),
        status: 'published',
        isPaused: false,
        vacancies,
        filledSeats: 0
    };
    const calls = [];
    return {
        listing,
        calls,
        async findOneAndUpdate(filter, update) {
            calls.push({ filter, update });
            if (update.$inc.filledSeats < 0) {
                if (listing.filledSeats <= 0) return null;
                listing.filledSeats += update.$inc.filledSeats;
                return { ...listing };
            }
            if (listing.status !== 'published' || listing.isPaused || listing.filledSeats >= listing.vacancies) return null;
            listing.filledSeats += update.$inc.filledSeats;
            return { ...listing };
        },
        async updateOne(filter, update) {
            calls.push({ filter, update });
            if (update.$set) Object.assign(listing, update.$set);
            return { modifiedCount: 1 };
        }
    };
}

function applicationModelFor(records) {
    const items = new Map(records.map(record => [String(record._id), record]));
    const canUse = (record, filter) => record
        && String(record.candidate) === String(filter.candidate)
        && (!filter.status || filter.status.$in.includes(record.status));
    return {
        items,
        async findOne(filter) {
            const record = items.get(String(filter._id));
            return canUse(record, filter) ? { ...record } : null;
        },
        async findOneAndUpdate(filter, update) {
            const record = items.get(String(filter._id));
            if (!canUse(record, filter)) return null;
            Object.assign(record, update.$set || {});
            Object.entries(update.$push || {}).forEach(([key, value]) => {
                record[key] = Array.isArray(record[key]) ? record[key] : [];
                record[key].push(value);
            });
            return { ...record, statusHistory: [...record.statusHistory] };
        }
    };
}

test('Offer records terms, expiry and an issuance audit event', async () => {
    const offer = new Offer({
        application: id(),
        internship: id(),
        candidate: id(),
        company: id(),
        issuedBy: id(),
        expiresAt: new Date(now.getTime() + 3600000),
        terms: { monthlyStipend: 12000, duration: '3 months' },
        events: [{ action: 'issued', actorRole: 'company', at: now }]
    });
    await assert.doesNotReject(offer.validate());
    assert.equal(Offer.schema.indexes().some(([fields, options]) => (
        fields.application === 1 && fields.isActive === 1 && options.unique && options.partialFilterExpression.isActive === true
    )), true);
});

test('offer issuance input requires a future expiry and normalizes listing terms', () => {
    assert.throws(() => parseOfferInput({ expiresAt: '2026-09-27T09:59:00.000Z' }, {}, now), OfferLifecycleError);
    const parsed = parseOfferInput({ expiresAt: '2026-09-28T10:00:00.000Z', additionalTerms: '  Bring ID  ' }, {
        monthlyStipend: 10000,
        duration: '12 Months'
    }, now);
    assert.equal(parsed.terms.monthlyStipend, 10000);
    assert.equal(parsed.terms.duration, '12 Months');
    assert.equal(parsed.terms.additionalTerms, 'Bring ID');
});

test('seat reservation uses a conditional atomic update and closes the final-seat listing', async () => {
    const InternshipModel = internshipModelWithSeats(1);
    const [first, second] = await Promise.all([
        reserveSeat(InternshipModel, InternshipModel.listing._id),
        reserveSeat(InternshipModel, InternshipModel.listing._id)
    ]);

    assert.equal([first, second].filter(result => result.reserved).length, 1);
    assert.equal(InternshipModel.listing.filledSeats, 1);
    assert.equal(InternshipModel.listing.status, 'closed');
    assert.equal(InternshipModel.listing.closedReason, 'capacity');
    assert.ok(InternshipModel.calls[0].filter.$expr, 'reservation must compare filled seats and vacancies in MongoDB');
});

test('concurrent accepts for a one-seat listing cannot overbook', async () => {
    const InternshipModel = internshipModelWithSeats(1);
    const firstOffer = offerRecord({ internship: InternshipModel.listing._id });
    const secondOffer = offerRecord({ internship: InternshipModel.listing._id });
    const OfferModel = offerModelFor([firstOffer, secondOffer]);
    const ApplicationModel = applicationModelFor([
        { _id: firstOffer.application, candidate: firstOffer.candidate, internship: firstOffer.internship, status: 'Interview', statusHistory: [] },
        { _id: secondOffer.application, candidate: secondOffer.candidate, internship: secondOffer.internship, status: 'Shortlisted', statusHistory: [] }
    ]);

    const outcomes = await Promise.allSettled([
        acceptOffer({ offerId: firstOffer._id, candidateId: firstOffer.candidate, now, OfferModel, ApplicationModel, InternshipModel }),
        acceptOffer({ offerId: secondOffer._id, candidateId: secondOffer.candidate, now, OfferModel, ApplicationModel, InternshipModel })
    ]);

    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter(result => result.status === 'rejected' && result.reason.code === 'NO_SEATS_AVAILABLE').length, 1);
    assert.equal(InternshipModel.listing.filledSeats, 1);
    assert.equal([...ApplicationModel.items.values()].filter(app => app.status === 'Hired').length, 1);
    assert.equal([...OfferModel.items.values()].filter(offer => offer.status === 'accepted').length, 1);
});

test('declining an offer records the decision on the offer and application timeline', async () => {
    const InternshipModel = internshipModelWithSeats(2);
    const record = offerRecord({ internship: InternshipModel.listing._id });
    const OfferModel = offerModelFor([record]);
    const ApplicationModel = applicationModelFor([{
        _id: record.application,
        candidate: record.candidate,
        internship: record.internship,
        status: 'Shortlisted',
        statusHistory: []
    }]);

    const offer = await declineOffer({
        offerId: record._id,
        candidateId: record.candidate,
        reason: 'Accepted a different role.',
        now,
        OfferModel,
        ApplicationModel,
        InternshipModel
    });

    const application = ApplicationModel.items.get(record.application);
    assert.equal(offer.status, 'declined');
    assert.equal(application.status, DECLINED_APPLICATION_STATUS);
    assert.equal(application.statusHistory.at(-1).offer, record._id);
    assert.equal(offer.events.at(-1).action, 'declined');
});

test('expired offers become inactive and cannot remain actionable', async () => {
    const InternshipModel = internshipModelWithSeats(2);
    const record = offerRecord({
        internship: InternshipModel.listing._id,
        expiresAt: new Date(now.getTime() - 1000)
    });
    const OfferModel = offerModelFor([record]);

    const expired = await expireOfferIfDue(record, { now, OfferModel, InternshipModel });
    assert.equal(expired.status, 'expired');
    assert.equal(expired.isActive, false);
    assert.equal(expired.events.at(-1).action, 'expired');
});

test('expiry releases a previously held seat and reopens only a capacity-closed listing', async () => {
    const InternshipModel = internshipModelWithSeats(1);
    InternshipModel.listing.filledSeats = 1;
    InternshipModel.listing.status = 'closed';
    InternshipModel.listing.closedReason = 'capacity';
    const record = offerRecord({
        internship: InternshipModel.listing._id,
        expiresAt: new Date(now.getTime() - 1000),
        seatReserved: true,
        status: 'issued'
    });
    const OfferModel = offerModelFor([record]);

    await expireOfferIfDue(record, { now, OfferModel, InternshipModel });
    assert.equal(InternshipModel.listing.filledSeats, 0);
    assert.equal(InternshipModel.listing.status, 'published');
    assert.equal(OfferModel.items.get(record._id).seatReserved, false);
});

test('offer notifications are accepted by the notification model', async () => {
    for (const type of ['offer_issued', 'offer_accepted', 'offer_declined', 'offer_expired']) {
        const field = type === 'offer_issued' ? { recipient: id() } : { companyId: id() };
        await assert.doesNotReject(new Notification({ ...field, type, title: 'Offer', message: 'Update' }).validate());
    }
});
