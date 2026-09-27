const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/User');
const Internship = require('../models/Internship');
const Application = require('../models/Application');
const { notifyNewApplication, checkAndNotifyHighVolume } = require('../utils/recruiterNotifications');
const Recommendation = require('../models/Recommendation');
const { isAuthenticated, authorize } = require('../middleware/auth');
const {
    companyName,
    companyInternshipQuery,
    requireCompanyPermission,
    requireVerifiedCompany,
    denyUnverifiedCompany
} = require('../middleware/companyAccess');
const { isCompanyVerified } = require('../utils/companyVerification');
const { parseISTEndOfDay } = require('../utils/dateUtils');
const { calculateSkillScore, analyzeSkillGap } = require('../utils/skillMatch');
const { notifyRelevantCandidates } = require('../utils/notifications');
const chatRouter = require('./chat');
const {
    parseInternshipQuery,
    buildPaginationData,
    buildQueryString,
    applyDurationFilter,
    getActiveFilters,
    clearFiltersHref,
    uniqueSortedOptions,
    DURATION_BUCKETS
} = require('../utils/queryHelper');
const { calculateCandidateMatch } = require('../utils/candidateMatcher');
const { buildSkillProfiles } = require('../utils/skillProfiles');
const {
    ApplicationKitValidationError,
    parseApplicationQuestions,
    getApplicationQuestions,
    getResumeVersions,
    getCandidateSkills,
    buildApplicationKit,
    hasApplicationQuestions
} = require('../utils/applicationKit');

function applicationResponseWantsJson(req) {
    return Boolean(req.xhr || req.is('json') || req.headers.accept?.includes('application/json'));
}

function applicationAvailabilityError(internship) {
    if (!internship) return 'Internship listing not found.';
    if (internship.status === 'draft' || internship.status === 'closed') {
        return 'This opportunity is not currently accepting applications.';
    }
    if (internship.status === 'paused' || internship.isPaused) {
        return 'Applications for this position are temporarily paused.';
    }
    const capacity = Number(internship.vacancies) > 0 ? Number(internship.vacancies) : 1;
    if (Number(internship.filledSeats || 0) >= capacity) {
        return 'All positions for this internship have been filled.';
    }
    if (internship.applicationDeadline && new Date() > new Date(internship.applicationDeadline)) {
        return 'The deadline to apply for this internship has passed.';
    }
    return null;
}

function duplicateApplicationError(error) {
    return error && (error.code === 11000 || error.code === 'DUPLICATE_APPLICATION');
}

async function createCandidateApplication({ candidate, internship, applicationKit }) {
    const existingApp = await Application.findOne({
        internship: internship._id,
        candidate: candidate._id
    }).select('_id');

    if (existingApp) {
        const error = new Error('You have already applied for this opportunity.');
        error.code = 'DUPLICATE_APPLICATION';
        error.statusCode = 409;
        throw error;
    }

    const now = applicationKit.submittedAt || new Date();
    const score = calculateCandidateMatch(candidate, internship).score;

    let application;
    try {
        application = await Application.create({
            internship: internship._id,
            candidate: candidate._id,
            matchScore: score,
            appliedAt: now,
            statusHistory: [{ status: 'Submitted', changedAt: now }],
            applicationKit
        });
    } catch (error) {
        if (error && error.code === 11000) {
            const duplicateError = new Error('You have already applied for this opportunity.');
            duplicateError.code = 'DUPLICATE_APPLICATION';
            duplicateError.statusCode = 409;
            throw duplicateError;
        }
        throw error;
    }

    // These auxiliary updates must not make a successful application fail.
    try {
        notifyNewApplication(application, internship);
        checkAndNotifyHighVolume(internship._id);
        await Recommendation.findOneAndDelete({
            internship: internship._id,
            candidate: candidate._id
        });
    } catch (error) {
        console.error('Error processing post-application updates:', error);
    }

    return application;
}

function questionsFromListingRequest(body, fallback = []) {
    const hasQuestionFields = Object.prototype.hasOwnProperty.call(body || {}, 'applicationQuestions')
        || Object.prototype.hasOwnProperty.call(body || {}, 'applicationQuestion')
        || Object.prototype.hasOwnProperty.call(body || {}, 'applicationQuestionsConfigured');

    return hasQuestionFields ? parseApplicationQuestions(body) : fallback;
}

function notifyPublishedInternship(internship) {
    if (typeof notifyRelevantCandidates !== 'function') return;

    notifyRelevantCandidates(internship).catch(error => {
        console.error('Failed to create internship match notifications:', error);
    });
}

router.get('/', async (req, res) => {
    try {
        const parsed = parseInternshipQuery(req.query);
        const { sortObj, state, page, limit } = parsed;
        const filterObj = await applyDurationFilter(parsed.filterObj, state.duration, Internship);

        const totalItems = await Internship.countDocuments(filterObj);
        const pagination = buildPaginationData(totalItems, page, limit);
        state.page = pagination.currentPage;

        const internships = await Internship.find(filterObj)
            .sort(sortObj)
            .skip(pagination.skip)
            .limit(pagination.limit);

        const [availableSectors, availableSkills] = await Promise.all([
            Internship.distinct('sector'),
            Internship.distinct('requiredSkills', { status: { $ne: 'draft' } })
        ]);
        const sectors = availableSectors.filter(Boolean).sort();
        const skillOptions = uniqueSortedOptions(availableSkills);

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
            skillOptions,
            durationBuckets: DURATION_BUCKETS,
            activeFilters: getActiveFilters(state),
            clearFiltersUrl: clearFiltersHref(state),
            buildQueryString
        });
    } catch (error) {
        console.error('Error fetching internships:', error);
        res.status(500).send('Database Error');
    }
});

router.get('/compare', async (req, res) => {
    try {
        const ids = req.query.ids ? req.query.ids.split(',') : [];
        if (ids.length < 2 || ids.length > 3) {
            if (req.flash) req.flash('error_msg', 'Please select 2 to 3 internships to compare.');
            return res.redirect('/internships');
        }

        const internships = await Internship.find({ _id: { $in: ids } })
            .populate('companyId', 'companyName')
            .lean();

        res.render('extras/internship-compare', { 
            internships, 
            currentUser: req.user 
        });
    } catch (error) {
        console.error('Error fetching internships for comparison:', error);
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
            const userCompanyId = req.user?.companyId || (req.user?.role === 'company' ? req.user._id : null);
            const isOwnerOrAdmin = req.user && (
                req.user.role === 'admin' ||
                (internship.companyId && userCompanyId && internship.companyId.toString() === userCompanyId.toString())
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

        let reviewStats = null;
        if (company && company._id) {
            const { calculateCompanyReviewStats } = require('../utils/reviews');
            reviewStats = await calculateCompanyReviewStats(company._id);
        }

        res.render('extras/internship-detail', {
            internship,
            company,
            candidate,
            currentUser: req.user,
            hasApplied,
            isPaused,
            reviewStats
        });
    } catch (error) {
        console.error('Error loading internship details:', error);
        res.status(500).send('Database Error');
    }
});

router.post('/new', isAuthenticated, requireCompanyPermission('internship:create'), requireVerifiedCompany({ allowDraft: true }), async (req, res) => {
    try {
        // The company name and ID are always resolved from the authenticated
        // company umbrella; a recruiter must never be able to submit a name
        // for another company.
        const { title, location, sector, stipend, monthlyStipend, vacancies, duration, requiredSkills, minQualifications, deadline, action, description, responsibilities: responsibilitiesRaw, eligibilityCriteria: eligibilityRaw } = req.body;
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

        const resolvedCompanyName = companyName(req.company);

        const parseLines = (raw) => (raw ? raw.split('\n').map(s => s.trim()).filter(Boolean) : []);

        const applicationQuestions = questionsFromListingRequest(req.body, []);

        const newInternship = new Internship({
            title: resolvedTitle,
            status,
            companyName: resolvedCompanyName,
            companyId: req.company._id,
            sector: sector || (isDraft ? 'Uncategorized' : 'General'),
            minQualifications: minQualifications || (isDraft ? '' : 'Any'),
            duration: duration || (isDraft ? '' : '12 Months'),
            description: description || '',
            responsibilities: parseLines(responsibilitiesRaw),
            eligibilityCriteria: parseLines(eligibilityRaw),
            applicationQuestions,
            location: { district, state },
            monthlyStipend: stipendNumber,
            vacancies: vacancies ? parseInt(vacancies) : 1,
            requiredSkills: requiredSkills ? requiredSkills.split(',').map(s => s.trim()).filter(Boolean) : [],
            postedBy: req.user._id,
            applicationDeadline
        });


        await newInternship.save();

        if (status === 'published') notifyPublishedInternship(newInternship);

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
        if (error instanceof ApplicationKitValidationError) {
            if (req.flash) req.flash('error_msg', error.message);
            return res.redirect('/internships');
        }
        res.status(500).send('Database Error');
    }
});

router.post('/:id/edit', isAuthenticated, requireCompanyPermission('internship:edit'), async (req, res) => {
    try {
        const internship = await Internship.findOne({ _id: req.params.id, ...companyInternshipQuery(req.company) });
        if (!internship) return res.status(404).send('Internship not found');

        // `companyInternshipQuery` above scopes this edit to the current
        // company, while `requireCompanyPermission` enforces the role.
        const { title, location, sector, stipend, monthlyStipend, duration, vacancies, requiredSkills, minQualifications, deadline, description, responsibilities: responsibilitiesRaw, eligibilityCriteria: eligibilityRaw } = req.body;

        const parseLines = (raw) => (raw ? raw.split('\n').map(s => s.trim()).filter(Boolean) : []);

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
        if (sector) internship.sector = sector;
        internship.location = { district, state };
        internship.monthlyStipend = stipendNumber;
        if (duration) internship.duration = duration;
        if (vacancies) internship.vacancies = parseInt(vacancies) || 1;
        if (minQualifications !== undefined) internship.minQualifications = minQualifications;
        if (description !== undefined) internship.description = description;
        if (responsibilitiesRaw !== undefined) internship.responsibilities = parseLines(responsibilitiesRaw);
        if (eligibilityRaw !== undefined) internship.eligibilityCriteria = parseLines(eligibilityRaw);

        if (requiredSkills !== undefined) {
            internship.requiredSkills = Array.isArray(requiredSkills) ? requiredSkills : requiredSkills.split(',').map(s => s.trim()).filter(Boolean);
        }
        internship.applicationDeadline = applicationDeadline;
        internship.applicationQuestions = questionsFromListingRequest(req.body, internship.applicationQuestions || []);

        await internship.save();

        if (typeof chatRouter !== 'undefined' && typeof chatRouter.invalidateChatCache === 'function') {
            chatRouter.invalidateChatCache();
        }

        if (req.flash) req.flash('success_msg', 'Internship updated successfully.');
        res.redirect('/internships');
    } catch (error) {
        console.error('Error updating internship:', error);
        if (error instanceof ApplicationKitValidationError) {
            if (req.flash) req.flash('error_msg', error.message);
            return res.redirect(`/internships/${req.params.id}/edit`);
        }
        res.status(500).send('Database Error');
    }
});

router.post('/:id/delete', isAuthenticated, requireCompanyPermission('internship:delete'), async (req, res) => {
    try {
        const internship = await Internship.findOneAndDelete({ _id: req.params.id, ...companyInternshipQuery(req.company) });
        if (!internship) return res.status(404).send('Internship not found');

        // Clean up orphaned applications for this deleted internship
        await Application.deleteMany({ internship: req.params.id });

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

router.get('/:id/application-kit', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            if (req.flash) req.flash('error_msg', 'Internship listing not found.');
            return res.redirect('/internships');
        }

        const [candidate, internship] = await Promise.all([
            User.findById(req.user._id),
            Internship.findById(req.params.id)
        ]);
        const unavailableMessage = applicationAvailabilityError(internship);
        if (!candidate || unavailableMessage) {
            if (req.flash) req.flash('error_msg', unavailableMessage || 'Candidate profile not found.');
            return res.redirect(internship ? `/internships/${internship._id}` : '/internships');
        }

        const existing = await Application.findOne({ internship: internship._id, candidate: candidate._id }).select('_id');
        if (existing) {
            if (req.flash) req.flash('error_msg', 'You have already applied for this opportunity.');
            return res.redirect('/candidate/applications');
        }

        return res.render('candidate/application-kit', {
            candidate,
            internship,
            questions: getApplicationQuestions(internship),
            resumeVersions: getResumeVersions(candidate),
            candidateSkills: getCandidateSkills(candidate)
        });
    } catch (error) {
        console.error('Error loading application kit:', error);
        if (req.flash) req.flash('error_msg', 'Unable to prepare this application kit. Please try again.');
        return res.redirect(`/internships/${req.params.id}`);
    }
});

router.post('/:id/application-kit/preview', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            if (req.flash) req.flash('error_msg', 'Internship listing not found.');
            return res.redirect('/internships');
        }

        const [candidate, internship] = await Promise.all([
            User.findById(req.user._id),
            Internship.findById(req.params.id)
        ]);
        const unavailableMessage = applicationAvailabilityError(internship);
        if (!candidate || unavailableMessage) {
            if (req.flash) req.flash('error_msg', unavailableMessage || 'Candidate profile not found.');
            return res.redirect(internship ? `/internships/${internship._id}` : '/internships');
        }

        const existing = await Application.findOne({ internship: internship._id, candidate: candidate._id }).select('_id');
        if (existing) {
            if (req.flash) req.flash('error_msg', 'You have already applied for this opportunity.');
            return res.redirect('/candidate/applications');
        }

        const applicationKit = buildApplicationKit({ candidate, internship, body: req.body });
        return res.render('candidate/application-kit-preview', {
            candidate,
            internship,
            applicationKit
        });
    } catch (error) {
        console.error('Error previewing application kit:', error);
        if (req.flash) {
            req.flash('error_msg', error instanceof ApplicationKitValidationError
                ? error.message
                : 'Unable to preview this application kit. Please try again.');
        }
        return res.redirect(`/internships/${req.params.id}/application-kit`);
    }
});

router.post('/:id/application-kit/submit', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            if (req.flash) req.flash('error_msg', 'Internship listing not found.');
            return res.redirect('/internships');
        }

        const [candidate, internship] = await Promise.all([
            User.findById(req.user._id),
            Internship.findById(req.params.id)
        ]);
        const unavailableMessage = applicationAvailabilityError(internship);
        if (!candidate || unavailableMessage) {
            if (req.flash) req.flash('error_msg', unavailableMessage || 'Candidate profile not found.');
            return res.redirect(internship ? `/internships/${internship._id}` : '/internships');
        }

        const applicationKit = buildApplicationKit({ candidate, internship, body: req.body });
        const application = await createCandidateApplication({ candidate, internship, applicationKit });

        if (applicationResponseWantsJson(req)) {
            return res.status(201).json({ success: true, applicationId: application._id });
        }
        if (req.flash) req.flash('success_msg', 'Your tailored application was submitted successfully!');
        return res.redirect('/candidate/applications');
    } catch (error) {
        console.error('Error submitting application kit:', error);
        const status = error.statusCode || (duplicateApplicationError(error) ? 409 : 500);
        const message = error instanceof ApplicationKitValidationError || duplicateApplicationError(error)
            ? error.message
            : 'Unable to submit this application. Please try again.';
        if (applicationResponseWantsJson(req)) return res.status(status).json({ error: message });
        if (req.flash) req.flash('error_msg', message);
        return res.redirect(duplicateApplicationError(error)
            ? '/candidate/applications'
            : `/internships/${req.params.id}/application-kit`);
    }
});

// Keep the original one-click behavior for simple listings. A listing that
// asks company questions must use the reviewed Application Kit flow, and the
// same restriction is enforced here to prevent a direct POST from bypassing it.
router.post('/:id/apply', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            if (applicationResponseWantsJson(req)) return res.status(404).json({ error: 'Internship listing not found.' });
            if (req.flash) req.flash('error_msg', 'Internship listing not found.');
            return res.redirect('/internships');
        }

        const [candidate, internship] = await Promise.all([
            User.findById(req.user._id),
            Internship.findById(req.params.id)
        ]);
        const unavailableMessage = applicationAvailabilityError(internship);
        if (!candidate || unavailableMessage) {
            if (applicationResponseWantsJson(req)) return res.status(400).json({ error: unavailableMessage || 'Candidate profile not found.' });
            if (req.flash) req.flash('error_msg', unavailableMessage || 'Candidate profile not found.');
            const referrer = req.get('Referrer');
            return res.redirect(referrer || (internship ? `/internships/${internship._id}` : '/internships'));
        }

        if (hasApplicationQuestions(internship)) {
            const message = 'This opportunity has application questions. Please complete your Application Kit before submitting.';
            if (applicationResponseWantsJson(req)) return res.status(400).json({ error: message, applicationKitUrl: `/internships/${internship._id}/application-kit` });
            if (req.flash) req.flash('error_msg', message);
            return res.redirect(`/internships/${internship._id}/application-kit`);
        }

        const applicationKit = buildApplicationKit({ candidate, internship, useDefaults: true });
        const application = await createCandidateApplication({ candidate, internship, applicationKit });

        if (applicationResponseWantsJson(req)) return res.status(201).json({ success: true, applicationId: application._id });
        if (req.flash) req.flash('success_msg', 'Application submitted successfully!');
        return res.redirect('/candidate/applications');
    } catch (error) {
        console.error('Error applying for internship:', error);
        const status = error.statusCode || (duplicateApplicationError(error) ? 409 : 500);
        const message = duplicateApplicationError(error)
            ? error.message
            : 'Unable to submit this application. Please try again.';
        if (applicationResponseWantsJson(req)) return res.status(status).json({ error: message });
        if (req.flash) req.flash('error_msg', message);
        return res.redirect(duplicateApplicationError(error) ? '/candidate/applications' : `/internships/${req.params.id}`);
    }
});

// The route middleware verifies permissions; this helper only validates the
// requested listing belongs to the resolved company.
async function verifyInternshipManager(req) {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return { authorized: false, error: 'Invalid internship ID.', statusCode: 400 };
    }

    const internship = await Internship.findOne({ _id: req.params.id, ...companyInternshipQuery(req.company) });
    if (!internship) {
        return { authorized: false, error: 'Internship not found or unauthorized.', statusCode: 404 };
    }

    return { authorized: true, internship };
}

router.post('/:id/pause', isAuthenticated, requireCompanyPermission('internship:edit'), async (req, res) => {
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

router.post('/:id/resume', isAuthenticated, requireCompanyPermission('internship:edit'), requireVerifiedCompany(), async (req, res) => {
    try {
        const { authorized, error, statusCode, internship } = await verifyInternshipManager(req);
        if (!authorized) {
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                return res.status(statusCode).json({ error });
            }
            if (req.flash) req.flash('error_msg', error);
            return res.redirect('/internships');
        }

        const becamePublished = internship.status !== 'published' || internship.isPaused === true;
        internship.status = 'published';
        internship.isPaused = false;
        await internship.save();

        if (becamePublished) notifyPublishedInternship(internship);

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

router.post('/:id/toggle-pause', isAuthenticated, requireCompanyPermission('internship:edit'), async (req, res) => {
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
        if (!willPause && !isCompanyVerified(req.company)) {
            return denyUnverifiedCompany(req, res);
        }
        if (willPause) {
            internship.status = 'paused';
            internship.isPaused = true;
        } else {
            internship.status = 'published';
            internship.isPaused = false;
        }
        await internship.save();

        if (!willPause) notifyPublishedInternship(internship);

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

router.get('/:id/applicants', isAuthenticated, requireCompanyPermission('applications:view'), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            if (req.flash) req.flash('error_msg', 'Invalid internship ID.');
            return res.redirect('/internships');
        }

        const internship = await Internship.findOne({ _id: req.params.id, ...companyInternshipQuery(req.company) });
        if (!internship) {
            if (req.flash) req.flash('error_msg', 'Unauthorized action or internship not found.');
            return res.redirect('/internships');
        }

        const applications = await Application.find({ internship: req.params.id })
            .populate('candidate')
            .populate('notes.createdBy')
            .sort({ _id: -1 });

        applications.forEach(application => {
            const match = calculateCandidateMatch(application.candidate, internship);
            application.matchScore = match.score;
            application.matchRationale = match.rationale;
            application.matchingSkills = match.matchingSkills;
            application.matchingSkillProfiles = match.matchingSkillProfiles;
            application.candidateSkillProfiles = buildSkillProfiles(application.candidate);
        });
        applications.sort((a, b) => b.matchScore - a.matchScore || b._id.getTimestamp() - a._id.getTimestamp());

        res.render('company/company-applicants', {
            internship,
            applications,
            user: req.user,
            permissions: req.companyPermissions
        });
    } catch (error) {
        console.error('Error fetching applicants:', error);
        res.status(500).send('Database Error');
    }
});

/**
 * GET /internships/:id/skill-gap
 *
 * Renders how the logged-in candidate's skills line up against one
 * internship's requirements. Drafts are excluded and the candidate is always
 * taken from the session, never from the URL.
 */
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

        const analysis = analyzeSkillGap(candidate, internship.requiredSkills || []);

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
