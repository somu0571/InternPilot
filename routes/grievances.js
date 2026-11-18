const express = require('express');
const router = express.Router();

const Grievance = require('../models/Grievance');
const { isAuthenticated, authorize } = require('../middleware/auth');
const grievances = require('../utils/grievances');

const { CATEGORIES, STATUS, TIERS, LIMITS, TICKET_PATTERN } = grievances;



router.get('/admin/dashboard', async (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        try {
            res.locals.grievanceSummary = await grievances.adminSummary();
        } catch (err) {
            console.error('Error loading grievance summary:', err);
        }
    }
    next();
});


function canRaise(req, res, next) {
    if (grievances.raiserRoleFor(req.user)) return next();
    if (req.user && req.user.role === 'admin') return res.redirect('/admin/grievances');
    if (req.flash) req.flash('error_msg', 'Only candidates and companies can raise a grievance.');
    return res.redirect('/grievance');
}


async function loadGrievance(req, res, next) {
    try {
        const ticket = String(req.params.ticket || '').toUpperCase();
        const grievance = TICKET_PATTERN.test(ticket) ? await Grievance.findOne({ ticket }) : null;
        if (!grievance || !grievances.canView(req.user, grievance)) return next('route');
        await grievances.refresh(grievance);
        req.grievance = grievance;
        return next();
    } catch (err) {
        return next(err);
    }
}

const back = (req, res, message, type = 'error_msg') => {
    if (message && req.flash) req.flash(type, message);
    return res.redirect(`/grievances/${req.grievance.ticket}`);
};

const renderForm = async (req, res, { values = {}, errors = [], status = 200 } = {}) => {
    res.status(status).render('grievances/new', {
        categories: CATEGORIES,
        tiers: TIERS,
        limits: LIMITS,
        linkOptions: await grievances.linkOptions(req.user),
        values,
        errors
    });
};

router.get('/grievances/new', isAuthenticated, canRaise, async (req, res, next) => {
    try {
        await renderForm(req, res, { values: { category: CATEGORIES[req.query.category] ? req.query.category : '' } });
    } catch (err) {
        next(err);
    }
});

router.post('/grievances/new', isAuthenticated, canRaise, async (req, res, next) => {
    try {
        const result = await grievances.createGrievance(req.user, req.body);
        if (!result.grievance) {
            return renderForm(req, res, { values: result.value, errors: result.errors, status: result.limited ? 429 : 400 });
        }
        const { ticket } = result.grievance;
        if (req.flash) req.flash('success_msg', `Grievance ${ticket} raised. The Internal Helpdesk will respond within 48 hours.`);
        return res.redirect(`/grievances/${ticket}`);
    } catch (err) {
        return next(err);
    }
});

router.get('/grievances/mine', isAuthenticated, async (req, res, next) => {
    try {
        if (req.user.role === 'admin') return res.redirect('/admin/grievances');
        const mine = await Grievance.find({ raisedBy: req.user._id }).sort({ updatedAt: -1 }).limit(100);
        for (const g of mine) await grievances.refresh(g);
        return res.render('grievances/mine', {
            grievances: mine.map(g => grievances.present(g)),
            canRaise: Boolean(grievances.raiserRoleFor(req.user))
        });
    } catch (err) {
        return next(err);
    }
});

router.get('/grievances/:ticket', isAuthenticated, loadGrievance, async (req, res, next) => {
    try {
        await req.grievance.populate([
            { path: 'raisedBy', select: 'name email role' },
            { path: 'internship', select: 'title companyName' }
        ]);
        res.render('grievances/show', {
            g: grievances.present(req.grievance),
            isAdmin: req.user.role === 'admin',
            statuses: STATUS,
            limits: LIMITS
        });
    } catch (err) {
        next(err);
    }
});



const raiserOnly = (req, res, next) => (req.user.role === 'admin' ? next('route') : next());

router.post('/grievances/:ticket/reply', isAuthenticated, loadGrievance, raiserOnly, async (req, res, next) => {
    try {
        const { error } = await grievances.addRaiserReply(req.grievance, req.user, req.body.message);
        return back(req, res, error || 'Your reply was added.', error ? 'error_msg' : 'success_msg');
    } catch (err) {
        return next(err);
    }
});

router.post('/grievances/:ticket/reopen', isAuthenticated, loadGrievance, raiserOnly, async (req, res, next) => {
    try {
        const { error } = await grievances.reopenGrievance(req.grievance, req.user, req.body.message);
        return back(req, res, error || 'The grievance was reopened.', error ? 'error_msg' : 'success_msg');
    } catch (err) {
        return next(err);
    }
});

router.get('/admin/grievances', isAuthenticated, authorize('admin'), async (req, res, next) => {
    try {
        const filters = {
            status: String(req.query.status || ''),
            tier: String(req.query.tier || ''),
            category: String(req.query.category || ''),
            overdue: req.query.overdue === '1'
        };
        const { items, counts } = await grievances.adminQueue(filters);
        res.render('grievances/admin', { items, counts, filters, categories: CATEGORIES, statuses: STATUS, tiers: TIERS });
    } catch (err) {
        next(err);
    }
});

router.post('/admin/grievances/:ticket/respond', isAuthenticated, authorize('admin'), loadGrievance, async (req, res, next) => {
    try {
        const { error } = await grievances.adminRespond(req.grievance, req.user, { message: req.body.message, status: req.body.status });
        return back(req, res, error || 'Response saved and the raiser was notified.', error ? 'error_msg' : 'success_msg');
    } catch (err) {
        return next(err);
    }
});

router.post('/admin/grievances/:ticket/escalate', isAuthenticated, authorize('admin'), loadGrievance, async (req, res, next) => {
    try {
        const { error } = await grievances.adminEscalate(req.grievance, req.user);
        return back(req, res, error || 'Escalated to the next tier.', error ? 'error_msg' : 'success_msg');
    } catch (err) {
        return next(err);
    }
});

module.exports = router;
