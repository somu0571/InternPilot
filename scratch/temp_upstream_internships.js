const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/User');
const Internship = require('../models/Internship');
const Application = require('../models/Application');
const Recommendation = require('../models/Recommendation');
const { isAuthenticated, authorize, requireCompanyRole } = require('../middleware/auth');
const { parseISTEndOfDay } = require('../utils/dateUtils');
const { calculateSkillScore, analyzeSkillGap } = require('../utils/skillMatch');
const { notifyRelevantCandidates } = require('../utils/notifications');
const chatRouter = require('./chat');
const { parseInternshipQuery, buildPaginationData, buildQueryString } = require('../utils/queryHelper');

router.get('/', async (req, res) => {
    try {
        const { filterObj, sortObj, state, page, limit } = parseInternshipQuery(req.query);

        const totalItems = await Internship.countDocuments(filterObj);
        const pagination = buildPaginationData(totalItems, page, limit);

        const internships = await Internship.find(filterObj)
            .sort(sortObj)
            .skip(pagination.skip)
            .limit(pagination.limit);

        const availableSectors = await Internship.distinct('sector');
        const sectors = availableSectors.filter(Boolean).sort();

        const candidate = req.user;
        const currentUser = req.user;

        let appliedIds = [];
        if (candidate) {
            const apps = await Application.find({ candidate: candidate._id }).select('internship');
            appliedIds = apps.map(appDoc => appDoc.internship ? appDoc.internship.toString() : null).filter(Boolean);
        }

        res.render('extras/internships', {
            internships,
            candidate,
            currentUser,
            appliedIds,
            queryState: state,
            currentFilter: state.status,
            pagination,
            sectors,
            buildQueryString
        });
    } catch (error) {
        console.error('Error fetching internships:', error);
        res.status(500).send('Database Error');
    }
});

router.get('/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            if (req.flash) req.flash('error_msg', 'Internship listing not found.');
            return res.redirect('/internships');
        }

        const internship = await Internship.findById(req.params.id);
        if (!internship) {
            if (req.flash) req.flash('error_msg', 'Internship listing not found.');
            return res.redirect('/internships');
        }

        if (internship.status === 'draft') {
            const isOwnerOrAdmin = req.user && (
                req.user.role === 'admin' ||
                (internship.companyId && req.user.companyId && internship.companyId.toString() === req.user.companyId.toString()) ||
                (internship.postedBy && internship.postedBy.toString() === req.user._id.toString())
            );
            if (!isOwnerOrAdmin) {
                if (req.flash) req.flash('error_msg', 'This internship listing is currently a private draft.');
                return res.redirect('/internships');
            }
        }

        const candidate = req.user;
        let hasApplied = false;
        if (candidate && candidate.role === 'candidate') {
            const existingApp = await Application.findOne({
                internship: internship._id,
                candidate: candidate._id
            });
            hasApplied = !!existingApp;
        }

        let company = null;
        if (internship.companyId) {
            company = await User.findById(internship.companyId);
        } else if (internship.companyName) {
            company = await User.findOne({
                role: 'company',
                'companyDetails.companyName': internship.companyName
            });
        }

        const isPaused = internship.status === 'paused' || internship.isPaused === true;

        res.render('extras/internship-detail', {
            internship,
            company,
            candidate,
            currentUser: req.user,
            hasApplied,
            isPaused
        });
    } catch (error) {
        console.error('Error loading internship details:', error);
        res.status(500).send('Database Error');
    }
});

router.post('/new', isAuthenticated, async (req, res) => {
    try {
        const isAdmin = req.user.role === 'admin';
        const isCompanyUser = ['company', 'recruiter'].includes(req.user.role);

        if (!isAdmin && !isCompanyUser) {
            if (req.flash) req.flash('error_msg', 'Unauthorized to post internships.');
            return res.redirect('/internships');
        }

        const { title, company: companyName, location, sector, stipend, monthlyStipend, vacancies, duration, requiredSkills, minQualifications, deadline, action, description } = req.body;

        const isDraft = action === 'draft';
        const status = isDraft ? 'draft' : 'published';
        const trimmedTitle = title && typeof title === 'string' ? title.trim() : '';

        if (!isDraft && !trimmedTitle) {
            if (req.flash) req.flash('error_msg', 'Internship title is required to publish an opportunity.');
            return res.redirect('/internships');
        }

        const resolvedTitle = trimmedTitle || (isDraft ? 'Untitled Draft' : 'Internship Opportunity');

        let applicationDeadline;
        if (deadline) {
            try {
                applicationDeadline = typeof parseISTEndOfDay === 'function' ? parseISTEndOfDay(deadline) : new Date(deadline);
            } catch (err) {
                if (req.flash) req.flash('error_msg', err.message || 'Invalid deadline date provided.');
                return res.redirect('/internships');
            }
        }

        const locationParts = location ? location.split(',') : [];
        const district = locationParts[0] ? locationParts[0].trim() : '';
        const state = locationParts[1] ? locationParts[1].trim() : '';
        const rawStipend = stipend !== undefined ? stipend : monthlyStipend;
        const stipendNumber = rawStipend ? parseInt(rawStipend.toString().replace(/[^0-9]/g, '')) : (isDraft ? 0 : 5000);

        let resolvedCompanyName = companyName || req.user.companyDetails?.companyName;
        if (!resolvedCompanyName && req.user.companyId) {
            const accountOwner = await User.findById(req.user.companyId);
            resolvedCompanyName = accountOwner?.companyDetails?.companyName || accountOwner?.name;
        }
        resolvedCompanyName = resolvedCompanyName || req.user.name;

        const newInternship = new Internship({
            title: resolvedTitle,
            status,
            companyName: resolvedCompanyName,
            companyId: req.user.companyId || req.user._id,
            sector: sector || (isDraft ? 'Uncategorized' : 'General'),
            minQualifications: minQualifications || (isDraft ? '' : 'Any'),
            duration: duration || (isDraft ? '' : '12 Months'),
            description: description || '',
            location: { district, state },
            monthlyStipend: stipendNumber,
            duration: duration || '12 Months',
            vacancies: vacancies ? parseInt(vacancies) : 1,
            requiredSkills: requiredSkills ? requiredSkills.split(',').map(s => s.trim()).filter(Boolean) : [],
            postedBy: req.user._id,
            applicationDeadline
        });

        await newInternship.save();

        if (status === 'published' && typeof notifyRelevantCandidates === 'function') {
            notifyRelevantCandidates(newInternship).catch(err => {
                console.error('Failed to create internship match notifications:', err);
            });
        }

        if (req.flash) {
            if (isDraft) {
                req.flash('success_msg', 'Draft saved successfully!');
                return res.redirect('/company/dashboard');
            } else {
                req.flash('success_msg', 'Internship opportunity posted!');
            }
        }
        res.redirect('/internships');
    } catch (error) {
        console.error('Error saving internship:', error);
        res.status(500).send('Database Error');
    }
});

router.post('/:id/edit', isAuthenticated, async (req, res) => {
    try {
        const isAdmin = req.user.role === 'admin';
        const isCompanyUser = ['company', 'recruiter'].includes(req.user.role);

        if (!isAdmin && !isCompanyUser) {
            if (req.flash) req.flash('error_msg', 'Unauthorized to edit internships.');
            return res.redirect('/internships');
        }

        const internship = await Internship.findById(req.params.id);
        if (!internship) return res.status(404).send('Internship not found');

        if (!isAdmin) {
            const isOwner = (internship.companyId && req.user.companyId && internship.companyId.toString() === req.user.companyId.toString()) ||
                            (internship.postedBy && internship.postedBy.toString() === req.user._id.toString());
            if (!isOwner) {
                if (req.flash) req.flash('error_msg', 'Unauthorized action.');
                return res.redirect('/internships');
            }
        }

        const { title, company: companyName, location, sector, stipend, monthlyStipend, duration, vacancies, requiredSkills, minQualifications, deadline, description } = req.body;

        const locationParts = location ? location.split(',') : [];
        const district = locationParts[0] ? locationParts[0].trim() : '';
        const state = locationParts[1] ? locationParts[1].trim() : '';
        const rawStipend = stipend !== undefined ? stipend : monthlyStipend;
        const stipendNumber = rawStipend ? parseInt(rawStipend.toString().replace(/[^0-9]/g, '')) : internship.monthlyStipend;

        let applicationDeadline = internship.applicationDeadline;
        if (deadline !== undefined) {
            if (deadline) {
                try {
                    applicationDeadline = typeof parseISTEndOfDay === 'function' ? parseISTEndOfDay(deadline) : new Date(deadline);
                } catch (err) {
                    if (req.flash) req.flash('error_msg', err.message || 'Invalid deadline date provided.');
                    return res.redirect('/internships');
                }
            } else {
                applicationDeadline = null;
            }
        }

        internship.title = title || internship.title;
        if (companyName) internship.companyName = companyName;
        if (sector) internship.sector = sector;
        internship.location = { district, state };
        internship.monthlyStipend = stipendNumber;
        if (duration) internship.duration = duration;
        if (vacancies) internship.vacancies = parseInt(vacancies) || 1;
        if (minQualifications !== undefined) internship.minQualifications = minQualifications;
        if (description !== undefined) internship.description = description;
        if (requiredSkills !== undefined) {
            internship.requiredSkills = Array.isArray(requiredSkills) ? requiredSkills : requiredSkills.split(',').map(s => s.trim()).filter(Boolean);
        }
        internship.applicationDeadline = applicationDeadline;

        await internship.save();

        if (typeof chatRouter !== 'undefined' && typeof chatRouter.invalidateChatCache === 'function') {
            chatRouter.invalidateChatCache();
        }

        if (req.flash) req.flash('success_msg', 'Internship updated successfully.');
        res.redirect('/internships');
    } catch (error) {
        console.error('Error updating internship:', error);
        res.status(500).send('Database Error');
    }
});

router.post('/:id/delete', isAuthenticated, async (req, res) => {
    try {
        const isAdmin = req.user.role === 'admin';
        const isCompanyUser = ['company', 'recruiter'].includes(req.user.role);

        if (!isAdmin && !isCompanyUser) {
            if (req.flash) req.flash('error_msg', 'Unauthorized action.');
            return res.redirect('/internships');
        }

        const internship = await Internship.findById(req.params.id);
        if (!internship) return res.status(404).send('Internship not found');

        if (!isAdmin) {
            const isOwner = (internship.companyId && req.user.companyId && internship.companyId.toString() === req.user.companyId.toString()) ||
                            (internship.postedBy && internship.postedBy.toString() === req.user._id.toString());
            if (!isOwner) {
                if (req.flash) req.flash('error_msg', 'Unauthorized action.');
                return res.redirect('/internships');
            }
        }

        await Internship.findByIdAndDelete(req.params.id);
        if (typeof chatRouter !== 'undefined' && typeof chatRouter.invalidateChatCache === 'function') {
            chatRouter.invalidateChatCache();
        }
        if (req.flash) req.flash('success_msg', 'Internship removed.');
        res.redirect('/internships');
    } catch (error) {
        console.error('Error deleting internship:', error);
        res.status(500).send('Database Error');
    }
});

router.post('/:id/apply', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const candidate = req.user;
        const internship = await Internship.findById(req.params.id);

        if (!candidate || !internship) {
            return res.status(404).send('Candidate or Internship not found');
        }

        if (internship.status === 'draft') {
            if (req.flash) req.flash('error_msg', 'This opportunity is not currently accepting applications.');
            return res.redirect('/internships');
        }

        if (internship.status === 'paused' || internship.isPaused) {
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                return res.status(400).json({ error: 'Applications for this position are temporarily paused.' });
            }
            if (req.flash) req.flash('error_msg', 'Applications for this position are temporarily paused.');
            const referrer = req.get('Referrer');
            return res.redirect(referrer || `/internships/${internship._id}`);
        }

        if (internship.applicationDeadline && new Date() > new Date(internship.applicationDeadline)) {
            if (req.flash) req.flash('error_msg', 'The deadline to apply for this internship has passed.');
            return res.redirect(`/internships/${internship._id}`);
        }

        const existingApp = await Application.findOne({
            internship: internship._id,
            candidate: candidate._id
        });

        if (existingApp) {
            if (req.flash) req.flash('error_msg', 'You have already applied for this opportunity.');
            return res.redirect('/candidate/applications');
        }

        const score = calculateSkillScore(candidate.skills || [], internship.requiredSkills || []);

        await Application.create({
            internship: internship._id,
            candidate: candidate._id,
            matchScore: score
        });

        
        await Recommendation.findOneAndDelete({
            internship: internship._id,
            candidate: candidate._id
        });

        if (req.flash) req.flash('success_msg', 'Application submitted successfully!');
        res.redirect('/candidate/applications');
    } catch (error) {
        console.error('Error applying for internship:', error);
        res.status(500).send('Database Error');
    }
});


async function verifyInternshipManager(req) {
    const isAdmin = req.user && req.user.role === 'admin';
    const isCompanyUser = req.user && ['company', 'recruiter'].includes(req.user.role);

    if (!isAdmin && !isCompanyUser) {
        return { authorized: false, error: 'Unauthorized. Only recruiters or administrators can modify listing status.', statusCode: 403 };
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return { authorized: false, error: 'Invalid internship ID.', statusCode: 400 };
    }

    const internship = await Internship.findById(req.params.id);
    if (!internship) {
        return { authorized: false, error: 'Internship not found.', statusCode: 404 };
    }

    if (!isAdmin) {
        const isOwner = (internship.companyId && req.user.companyId && internship.companyId.toString() === req.user.companyId.toString()) ||
                        (internship.postedBy && internship.postedBy.toString() === req.user._id.toString());
        if (!isOwner) {
            return { authorized: false, error: 'Unauthorized. You do not own this internship listing.', statusCode: 403 };
        }
    }

    return { authorized: true, internship };
}

router.post('/:id/pause', isAuthenticated, async (req, res) => {
    try {
        const { authorized, error, statusCode, internship } = await verifyInternshipManager(req);
        if (!authorized) {
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                return res.status(statusCode).json({ error });
            }
            if (req.flash) req.flash('error_msg', error);
            return res.redirect('/internships');
        }

        if (internship.status === 'draft') {
            const msg = 'Draft listings cannot be paused. Publish the listing first.';
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                return res.status(400).json({ error: msg });
            }
            if (req.flash) req.flash('error_msg', msg);
            return res.redirect('/company/dashboard');
        }

        internship.status = 'paused';
        internship.isPaused = true;
        await internship.save();

        if (typeof chatRouter !== 'undefined' && typeof chatRouter.invalidateChatCache === 'function') {
            chatRouter.invalidateChatCache();
        }

        const successMsg = `Applications for "${internship.title}" are now temporarily paused.`;
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.json({ success: true, isPaused: true, status: 'paused', message: successMsg });
        }
        if (req.flash) req.flash('success_msg', successMsg);
        const referrer = req.get('Referrer');
        res.redirect(referrer || '/company/dashboard');
    } catch (err) {
        console.error('Error pausing internship:', err);
        res.status(500).send('Database Error');
    }
});

router.post('/:id/resume', isAuthenticated, async (req, res) => {
    try {
        const { authorized, error, statusCode, internship } = await verifyInternshipManager(req);
        if (!authorized) {
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                return res.status(statusCode).json({ error });
            }
            if (req.flash) req.flash('error_msg', error);
            return res.redirect('/internships');
        }

        internship.status = 'published';
        internship.isPaused = false;
        await internship.save();

        if (typeof chatRouter !== 'undefined' && typeof chatRouter.invalidateChatCache === 'function') {
            chatRouter.invalidateChatCache();
        }

        const successMsg = `Applications for "${internship.title}" have been resumed! New candidates can now apply.`;
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.json({ success: true, isPaused: false, status: 'published', message: successMsg });
        }
        if (req.flash) req.flash('success_msg', successMsg);
        const referrer = req.get('Referrer');
        res.redirect(referrer || '/company/dashboard');
    } catch (err) {
        console.error('Error resuming internship:', err);
        res.status(500).send('Database Error');
    }
});

router.post('/:id/toggle-pause', isAuthenticated, async (req, res) => {
    try {
        const { authorized, error, statusCode, internship } = await verifyInternshipManager(req);
        if (!authorized) {
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                return res.status(statusCode).json({ error });
            }
            if (req.flash) req.flash('error_msg', error);
            return res.redirect('/internships');
        }

        if (internship.status === 'draft') {
            const msg = 'Draft listings cannot be paused. Publish the listing first.';
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                return res.status(400).json({ error: msg });
            }
            if (req.flash) req.flash('error_msg', msg);
            return res.redirect('/company/dashboard');
        }

        const willPause = !(internship.status === 'paused' || internship.isPaused);
        if (willPause) {
            internship.status = 'paused';
            internship.isPaused = true;
        } else {
            internship.status = 'published';
            internship.isPaused = false;
        }
        await internship.save();

        if (typeof chatRouter !== 'undefined' && typeof chatRouter.invalidateChatCache === 'function') {
            chatRouter.invalidateChatCache();
        }

        const msg = willPause
            ? `Applications for "${internship.title}" are now temporarily paused.`
            : `Applications for "${internship.title}" have been resumed!`;

        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.json({ success: true, isPaused: willPause, status: internship.status, message: msg });
        }
        if (req.flash) req.flash('success_msg', msg);
        const referrer = req.get('Referrer');
        res.redirect(referrer || '/company/dashboard');
    } catch (err) {
        console.error('Error toggling pause state:', err);
        res.status(500).send('Database Error');
    }
});

router.get('/:id/applicants', isAuthenticated, requireCompanyRole(['company', 'recruiter']), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            if (req.flash) req.flash('error_msg', 'Invalid internship ID.');
            return res.redirect('/internships');
        }

        const internship = await Internship.findById(req.params.id);
        if (!internship) {
            if (req.flash) req.flash('error_msg', 'Unauthorized action or internship not found.');
            return res.redirect('/internships');
        }

        const isAuthorized = req.user.role === 'admin' ||
            (internship.companyId && req.user.companyId && internship.companyId.toString() === req.user.companyId.toString()) ||
            (internship.postedBy && internship.postedBy.toString() === req.user._id.toString());

        if (!isAuthorized) {
            if (req.flash) req.flash('error_msg', 'Unauthorized to view applicants for this listing.');
            return res.redirect('/internships');
        }

        const applications = await Application.find({ internship: req.params.id })
            .populate('candidate')
            .populate('notes.createdBy')
            .sort({ matchScore: -1 });

        res.render('company/company-applicants', { internship, applications, user: req.user });
    } catch (error) {
        console.error('Error fetching applicants:', error);
        res.status(500).send('Database Error');
    }
});


router.get('/:id/skill-gap', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const internship = await Internship.findOne({ _id: req.params.id, status: { $ne: 'draft' } });
        if (!internship) {
            if (req.flash) req.flash('error_msg', 'That internship is no longer available.');
            return res.redirect('/internships');
        }

        const candidate = await User.findById(req.user._id || req.user.id);
        if (!candidate) {
            if (req.flash) req.flash('error_msg', 'Could not load your profile. Please log in again.');
            return res.redirect('/internships');
        }

        const analysis = analyzeSkillGap(candidate.skills || [], internship.requiredSkills || []);

        const existingApp = await Application.findOne({
            internship: internship._id,
            candidate: candidate._id
        }).select('_id');

        res.render('candidate/skill-gap', {
            internship,
            candidate,
            user: candidate,
            analysis,
            alreadyApplied: Boolean(existingApp),
            isPaused: internship.status === 'paused' || internship.isPaused === true,
            deadlinePassed: Boolean(internship.applicationDeadline && new Date() > internship.applicationDeadline)
        });
    } catch (error) {
        console.error('Error building skill gap analysis:', error);
        if (req.flash) req.flash('error_msg', 'Could not load the skill gap analysis. Please try again.');
        res.redirect('/internships');
    }
});

module.exports = router;
