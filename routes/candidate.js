/**
 * Candidate Routes - InternPilot
 * Handles candidate specific actions including application tracking and withdrawal.
 */
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const Application = require('../models/Application');
const User = require('../models/User');
const Internship = require('../models/Internship');
const SavedSearch = require('../models/SavedSearch');
const { notifyCandidateWithdrawal } = require('../utils/recruiterNotifications');
const { isAuthenticated, authorize } = require('../middleware/auth');
const { formatRelativeTime, formatLocalizedDateTime } = require('../utils/dateFormat');
const { filterAndSortApplications } = require('../utils/applicationSearch');
const {
    normalizeSavedSearchCriteria,
    hasSavedSearchCriteria,
    getSavedSearchCriteriaHash,
    buildSavedSearchResultsUrl,
    matchesInternshipCriteria,
    describeSavedSearchCriteria
} = require('../utils/queryHelper');

const MAX_SAVED_SEARCHES = 10;

function parseSavedSearchCriteria(rawCriteria) {
    if (typeof rawCriteria === 'string') {
        try {
            return normalizeSavedSearchCriteria(JSON.parse(rawCriteria));
        } catch (error) {
            throw new Error('The saved-search filters were invalid. Please try saving the search again.');
        }
    }

    if (rawCriteria && typeof rawCriteria === 'object' && !Array.isArray(rawCriteria)) {
        return normalizeSavedSearchCriteria(rawCriteria);
    }

    throw new Error('Choose at least one filter before saving this search.');
}

function readCheckbox(value) {
    return value === true || value === 'true' || value === '1' || value === 'on';
}

function getAlertSettings(body = {}, fallback = {}) {
    const candidateFrequency = typeof body.frequency === 'string'
        ? body.frequency.trim().toLowerCase()
        : (fallback.frequency || 'instant');
    const frequency = ['instant', 'daily', 'weekly', 'off'].includes(candidateFrequency)
        ? candidateFrequency
        : null;

    if (!frequency) throw new Error('Choose a valid alert frequency.');

    const hasExplicitDelivery = readCheckbox(body.deliveryConfigured)
        || Object.prototype.hasOwnProperty.call(body, 'inApp')
        || Object.prototype.hasOwnProperty.call(body, 'email');
    const delivery = hasExplicitDelivery
        ? { inApp: readCheckbox(body.inApp), email: readCheckbox(body.email) }
        : {
            inApp: fallback.delivery?.inApp !== false,
            email: Boolean(fallback.delivery?.email)
        };

    if (frequency !== 'off' && !delivery.inApp && !delivery.email) {
        throw new Error('Select in-app notifications, email, or both.');
    }

    return { frequency, delivery };
}

function getSavedSearchName(value, fallback = '') {
    const name = typeof value === 'string' ? value.trim() : fallback;
    if (!name) throw new Error('Give this saved search a name.');
    if (name.length > 80) throw new Error('Saved search names must be 80 characters or fewer.');
    return name;
}

function savedSearchReturnPath(req, fallback = '/candidate/saved-searches') {
    const candidate = typeof req.body?.returnTo === 'string' ? req.body.returnTo : '';
    if (candidate.startsWith('/internships') || candidate.startsWith('/candidate/saved-searches')) return candidate;
    return fallback;
}

function isValidSavedSearchId(value) {
    return mongoose.Types.ObjectId.isValid(value);
}

// MongoDB is the final authority for the candidate + criteriaHash unique
// index. The read-before-write checks below make the common path friendly,
// while this recognises the small window where two identical requests reach
// the index at the same time.
function isSavedSearchDuplicateKeyError(error) {
    if (error?.code !== 11000) return false;

    const keyPattern = error.keyPattern;
    return !keyPattern || (
        Object.prototype.hasOwnProperty.call(keyPattern, 'candidate')
        && Object.prototype.hasOwnProperty.call(keyPattern, 'criteriaHash')
    );
}

function applyRepeatedSavedSearchSettings(savedSearch, { name, frequency, delivery, now }) {
    savedSearch.name = name;
    savedSearch.frequency = frequency;
    savedSearch.delivery = delivery;
    savedSearch.isPaused = false;
    savedSearch.alertStartAt = now;
    if (frequency === 'daily' || frequency === 'weekly') savedSearch.lastDigestAt = now;
}

async function getPublishedListingsForSavedSearches() {
    const now = new Date();
    return Internship.find({
        status: 'published',
        isPaused: { $ne: true },
        $or: [
            { applicationDeadline: { $exists: false } },
            { applicationDeadline: null },
            { applicationDeadline: { $gte: now } }
        ]
    }).select('_id title companyName sector location requiredSkills monthlyStipend duration applicationDeadline status isPaused').lean();
}

/**
 * GET /candidate/saved-internships
 * Renders the saved internships dashboard.
 */
router.get('/candidate/saved-internships', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const user = await User.findById(req.user._id).populate({
            path: 'savedInternships',
            populate: { path: 'companyId', select: 'companyName' }
        }).lean();
        
        res.render('candidate/saved-internships', {
            internships: user.savedInternships || [],
            currentUser: req.user
        });
    } catch (error) {
        console.error('Error fetching saved internships:', error);
        req.flash('error_msg', 'Failed to load saved internships.');
        res.redirect('/');
    }
});

/**
 * POST /candidate/saved-internships/:id/toggle
 * Toggles the saved status of an internship for the candidate.
 */
router.post('/candidate/saved-internships/:id/toggle', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const internshipId = req.params.id;
        
        const index = user.savedInternships.indexOf(internshipId);
        let isSaved = false;
        
        if (index === -1) {
            user.savedInternships.push(internshipId);
            isSaved = true;
        } else {
            user.savedInternships.splice(index, 1);
        }
        
        await user.save();
        res.json({ success: true, isSaved });
    } catch (error) {
        console.error('Error toggling saved internship:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * GET /candidate/saved-searches
 * Shows saved filters with an accurate current-match count and a compact
 * preview. The same pure matcher is used when an alert is delivered.
 */
router.get('/candidate/saved-searches', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const [savedSearches, publishedInternships] = await Promise.all([
            SavedSearch.find({ candidate: req.user._id }).sort({ updatedAt: -1 }).lean(),
            getPublishedListingsForSavedSearches()
        ]);

        const savedSearchCards = savedSearches.map(savedSearch => {
            const matches = publishedInternships.filter(internship =>
                matchesInternshipCriteria(internship, savedSearch.criteria)
            );

            return {
                ...savedSearch,
                criteriaLabels: describeSavedSearchCriteria(savedSearch.criteria),
                resultsUrl: buildSavedSearchResultsUrl(savedSearch.criteria),
                matchingCount: matches.length,
                matchingPreview: matches.slice(0, 3)
            };
        });

        res.render('candidate/saved-searches', {
            currentUser: req.user,
            savedSearches: savedSearchCards,
            maxSavedSearches: MAX_SAVED_SEARCHES
        });
    } catch (error) {
        console.error('Error loading saved searches:', error);
        if (req.flash) req.flash('error_msg', 'Failed to load saved searches. Please try again.');
        res.redirect('/internships');
    }
});

/**
 * POST /candidate/saved-searches
 * Persists a normalized copy of the selected filters. A candidate can save a
 * given criterion set once; re-saving it updates its alert preferences.
 */
router.post('/candidate/saved-searches', isAuthenticated, authorize('candidate'), async (req, res) => {
    const returnTo = savedSearchReturnPath(req, '/internships');

    try {
        const criteria = parseSavedSearchCriteria(req.body?.criteria);
        if (!hasSavedSearchCriteria(criteria)) {
            throw new Error('Choose at least one filter before saving this search.');
        }

        const name = getSavedSearchName(req.body?.name);
        const { frequency, delivery } = getAlertSettings(req.body);
        const criteriaHash = getSavedSearchCriteriaHash(criteria);
        const now = new Date();
        const existing = await SavedSearch.findOne({ candidate: req.user._id, criteriaHash });

        if (existing) {
            applyRepeatedSavedSearchSettings(existing, { name, frequency, delivery, now });
            await existing.save();
            if (req.flash) req.flash('success_msg', 'Updated your existing saved search and alert preferences.');
            return res.redirect(returnTo);
        }

        const currentCount = await SavedSearch.countDocuments({ candidate: req.user._id });
        if (currentCount >= MAX_SAVED_SEARCHES) {
            // A concurrent matching save can occupy the final slot between
            // the first lookup and this count. It is still an idempotent
            // update, not a new eleventh search.
            const concurrentSearch = await SavedSearch.findOne({ candidate: req.user._id, criteriaHash });
            if (concurrentSearch) {
                applyRepeatedSavedSearchSettings(concurrentSearch, { name, frequency, delivery, now });
                await concurrentSearch.save();
                if (req.flash) req.flash('success_msg', 'Updated your existing saved search and alert preferences.');
                return res.redirect(returnTo);
            }
            throw new Error(`You can save up to ${MAX_SAVED_SEARCHES} searches. Delete or edit an existing one first.`);
        }

        try {
            await SavedSearch.create({
                candidate: req.user._id,
                name,
                criteria,
                criteriaHash,
                frequency,
                delivery,
                alertStartAt: now,
                lastDigestAt: frequency === 'daily' || frequency === 'weekly' ? now : undefined
            });
        } catch (error) {
            if (!isSavedSearchDuplicateKeyError(error)) throw error;

            // A concurrent request saved the same filters after our initial
            // lookup. Update that one record so repeat saves stay idempotent
            // instead of exposing an E11000 error to the candidate.
            const concurrentSearch = await SavedSearch.findOne({ candidate: req.user._id, criteriaHash });
            if (!concurrentSearch) {
                throw new Error('This saved search changed while it was being saved. Please try again.');
            }

            applyRepeatedSavedSearchSettings(concurrentSearch, { name, frequency, delivery, now });
            await concurrentSearch.save();
            if (req.flash) req.flash('success_msg', 'Updated your existing saved search and alert preferences.');
            return res.redirect(returnTo);
        }

        if (req.flash) req.flash('success_msg', 'Search saved. We will alert you when new matches are published.');
        return res.redirect(returnTo);
    } catch (error) {
        console.error('Error saving internship search:', error);
        const message = isSavedSearchDuplicateKeyError(error)
            ? 'A matching saved search was updated at the same time. Please try again.'
            : (error.message || 'Unable to save this search. Please try again.');
        if (req.flash) req.flash('error_msg', message);
        return res.redirect(returnTo);
    }
});

/**
 * PATCH /candidate/saved-searches/:id
 * Edits the title and alert preferences. The criteria field is optional so a
 * settings form cannot accidentally discard a saved filter; API clients may
 * provide it to update filters after choosing a different result set.
 */
router.patch('/candidate/saved-searches/:id', isAuthenticated, authorize('candidate'), async (req, res) => {
    const returnTo = savedSearchReturnPath(req);

    try {
        if (!isValidSavedSearchId(req.params.id)) throw new Error('Saved search not found.');
        const savedSearch = await SavedSearch.findOne({ _id: req.params.id, candidate: req.user._id });
        if (!savedSearch) throw new Error('Saved search not found.');

        const nextCriteria = Object.prototype.hasOwnProperty.call(req.body || {}, 'criteria')
            ? parseSavedSearchCriteria(req.body.criteria)
            : normalizeSavedSearchCriteria(savedSearch.criteria);
        if (!hasSavedSearchCriteria(nextCriteria)) {
            throw new Error('Choose at least one filter before saving this search.');
        }

        const criteriaHash = getSavedSearchCriteriaHash(nextCriteria);
        const duplicate = await SavedSearch.exists({
            candidate: req.user._id,
            criteriaHash,
            _id: { $ne: savedSearch._id }
        });
        if (duplicate) throw new Error('You already have a saved search with those filters.');

        const name = getSavedSearchName(req.body?.name, savedSearch.name);
        const { frequency, delivery } = getAlertSettings(req.body, savedSearch);
        const criteriaChanged = criteriaHash !== savedSearch.criteriaHash;
        const frequencyChanged = frequency !== savedSearch.frequency;

        savedSearch.name = name;
        savedSearch.criteria = nextCriteria;
        savedSearch.criteriaHash = criteriaHash;
        savedSearch.frequency = frequency;
        savedSearch.delivery = delivery;
        if (criteriaChanged || frequencyChanged) {
            const now = new Date();
            savedSearch.alertStartAt = now;
            if (frequency === 'daily' || frequency === 'weekly') savedSearch.lastDigestAt = now;
        }
        await savedSearch.save();

        if (req.flash) req.flash('success_msg', 'Saved search updated.');
        return res.redirect(returnTo);
    } catch (error) {
        console.error('Error updating saved search:', error);
        const message = isSavedSearchDuplicateKeyError(error)
            ? 'You already have a saved search with those filters.'
            : (error.message || 'Unable to update this saved search.');
        if (req.flash) req.flash('error_msg', message);
        return res.redirect(returnTo);
    }
});

/**
 * POST /candidate/saved-searches/:id/pause
 * Explicitly supports pause and resume without removing a candidate's chosen
 * filters or their selected alert settings.
 */
router.post('/candidate/saved-searches/:id/pause', isAuthenticated, authorize('candidate'), async (req, res) => {
    const returnTo = savedSearchReturnPath(req);

    try {
        if (!isValidSavedSearchId(req.params.id)) throw new Error('Saved search not found.');
        const savedSearch = await SavedSearch.findOne({ _id: req.params.id, candidate: req.user._id });
        if (!savedSearch) throw new Error('Saved search not found.');

        const wasPaused = savedSearch.isPaused;
        savedSearch.isPaused = readCheckbox(req.body?.isPaused);
        if (wasPaused && !savedSearch.isPaused) {
            // Resuming begins a fresh alert window. Candidates should not get
            // a backlog of internships published while the search was paused.
            const now = new Date();
            savedSearch.alertStartAt = now;
            if (savedSearch.frequency === 'daily' || savedSearch.frequency === 'weekly') {
                savedSearch.lastDigestAt = now;
            }
        }
        await savedSearch.save();
        if (req.flash) req.flash('success_msg', savedSearch.isPaused ? 'Saved-search alerts paused.' : 'Saved-search alerts resumed.');
        return res.redirect(returnTo);
    } catch (error) {
        console.error('Error pausing saved search:', error);
        if (req.flash) req.flash('error_msg', error.message || 'Unable to change the saved-search alert state.');
        return res.redirect(returnTo);
    }
});

/**
 * DELETE /candidate/saved-searches/:id
 * Candidate ownership is included in the deletion query to prevent IDOR.
 */
router.delete('/candidate/saved-searches/:id', isAuthenticated, authorize('candidate'), async (req, res) => {
    const returnTo = savedSearchReturnPath(req);

    try {
        if (!isValidSavedSearchId(req.params.id)) throw new Error('Saved search not found.');
        const deleted = await SavedSearch.findOneAndDelete({ _id: req.params.id, candidate: req.user._id });
        if (!deleted) throw new Error('Saved search not found.');
        if (req.flash) req.flash('success_msg', 'Saved search deleted.');
        return res.redirect(returnTo);
    } catch (error) {
        console.error('Error deleting saved search:', error);
        if (req.flash) req.flash('error_msg', error.message || 'Unable to delete this saved search.');
        return res.redirect(returnTo);
    }
});

/**
 * GET /candidate/saved-searches/:id/edit
 * Gives candidates a full filter editor instead of requiring them to recreate
 * a search when their target skill, city, stipend, or duration changes.
 */
router.get('/candidate/saved-searches/:id/edit', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        if (!isValidSavedSearchId(req.params.id)) throw new Error('Saved search not found.');
        const savedSearch = await SavedSearch.findOne({ _id: req.params.id, candidate: req.user._id }).lean();
        if (!savedSearch) throw new Error('Saved search not found.');

        res.render('candidate/saved-search-edit', {
            currentUser: req.user,
            savedSearch
        });
    } catch (error) {
        console.error('Error loading saved-search editor:', error);
        if (req.flash) req.flash('error_msg', error.message || 'Unable to edit this saved search.');
        res.redirect('/candidate/saved-searches');
    }
});

/**
 * GET /candidate/saved-searches/:id/results
 * Uses a server-owned criterion record rather than accepting a caller-provided
 * filter object, then returns to the standard searchable opportunities page.
 */
router.get('/candidate/saved-searches/:id/results', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        if (!isValidSavedSearchId(req.params.id)) throw new Error('Saved search not found.');
        const savedSearch = await SavedSearch.findOne({ _id: req.params.id, candidate: req.user._id }).lean();
        if (!savedSearch) throw new Error('Saved search not found.');
        return res.redirect(buildSavedSearchResultsUrl(savedSearch.criteria));
    } catch (error) {
        console.error('Error opening saved-search results:', error);
        if (req.flash) req.flash('error_msg', error.message || 'Unable to open this saved search.');
        return res.redirect('/candidate/saved-searches');
    }
});

/**
 * GET /candidate/my-applications
 * Preserves the legacy URL while using the same canonical application-card
 * renderer as /candidate/applications.
 */
router.get('/candidate/my-applications', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const userId = req.user._id || req.user.id;
        const candidate = await User.findById(userId);
        const searchQuery = (req.query.search || '').trim();
        const statusFilter = (req.query.status || 'all').trim();
        const sortOrder = (req.query.sort || 'applied_desc').trim();

        const allApplications = await Application.find({ candidate: userId });
        const stats = {
            total: allApplications.length,
            submitted: allApplications.filter(a => a.status === 'Submitted').length,
            underReview: allApplications.filter(a => a.status === 'Under Review').length,
            shortlisted: allApplications.filter(a => a.status === 'Shortlisted').length,
            rejected: allApplications.filter(a => a.status === 'Rejected').length
        };

        let query = { candidate: userId };

        if (statusFilter !== 'all') {
            if (statusFilter.toLowerCase() === 'submitted') {
                query.status = { $in: ['Submitted', 'pending'] };
            } else {
                query.status = new RegExp('^' + statusFilter.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '$', 'i');
            }
        }

        if (searchQuery) {
            const Internship = require('../models/Internship');
            const escapeRegex = (text) => text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
            const regex = new RegExp(escapeRegex(searchQuery), 'gi');

            const matchingInternships = await Internship.find({
                $or: [{ title: regex }, { companyName: regex }, { company: regex }]
            }).select('_id');

            const internshipIds = matchingInternships.map(i => i._id);
            query.internship = { $in: internshipIds };
        }

        let sortObj = { appliedAt: -1, _id: -1 };
        if (sortOrder === 'applied_asc') {
            sortObj = { appliedAt: 1, _id: 1 };
        } else if (sortOrder === 'updated_desc') {
            sortObj = { statusUpdatedAt: -1, _id: -1 };
        } else if (sortOrder === 'match_desc') {
            sortObj = { matchScore: -1, _id: -1 };
        }

        const applications = await Application.find(query)
            .populate('internship')
            .sort(sortObj);

        const applicationSearch = filterAndSortApplications(applications, req.query);

        res.render('candidate/candidate-tracker', {
            candidate,
            currentUser: req.user,
            applications: applicationSearch.applications,
            stats,
            searchQuery: applicationSearch.search,
            statusFilter: applicationSearch.status,
            sort: applicationSearch.sort,
            totalApplications: allApplications.length,
            pageTitle: 'My Applications',
            formatRelativeTime,
            formatLocalizedDateTime
        });
    } catch (error) {
        console.error('Error fetching candidate applications:', error);
        res.status(500).send('Database Error');
    }
});

/**
 * GET /candidate/applications/:id/kit
 *
 * Shows the immutable, server-recorded Application Kit for the signed-in
 * candidate. Querying by both _id and candidate is deliberate: an
 * application identifier must never reveal another candidate's submission.
 */
router.get('/candidate/applications/:id/kit', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const candidateId = req.user._id || req.user.id;
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            if (req.flash) req.flash('error_msg', 'Application not found.');
            return res.redirect('/candidate/applications');
        }

        const application = await Application.findOne({
            _id: req.params.id,
            candidate: candidateId
        }).populate('internship');

        if (!application) {
            if (req.flash) req.flash('error_msg', 'Application not found.');
            return res.redirect('/candidate/applications');
        }

        return res.render('candidate/application-kit-submission', {
            application,
            internship: application.internship,
            currentUser: req.user
        });
    } catch (error) {
        console.error('Error loading submitted application kit:', error);
        if (req.flash) req.flash('error_msg', 'Unable to load the submitted application kit.');
        return res.redirect('/candidate/applications');
    }
});

/**
 * Core withdrawal logic handler.
 * Supports both POST and PATCH methods for /candidate/applications/:id/withdraw.
 */
async function handleApplicationWithdrawal(req, res) {
    try {
        const { id } = req.params;
        const reason = req.body && req.body.reason ? String(req.body.reason).trim() : '';

        // Validate ObjectId format
        if (!mongoose.Types.ObjectId.isValid(id)) {
            const errorMsg = 'Invalid application ID provided.';
            if (req.xhr || req.headers.accept?.includes('application/json') || req.is('json')) {
                return res.status(400).json({ success: false, error: errorMsg });
            }
            if (req.flash) req.flash('error_msg', errorMsg);
            return res.redirect('/candidate/applications');
        }

        const application = await Application.findById(id).populate('internship');

        if (!application) {
            const errorMsg = 'Application not found.';
            if (req.xhr || req.headers.accept?.includes('application/json') || req.is('json')) {
                return res.status(404).json({ success: false, error: errorMsg });
            }
            if (req.flash) req.flash('error_msg', errorMsg);
            return res.redirect('/candidate/applications');
        }

        // Ownership & IDOR Protection: Only the applicant can withdraw their application
        const candidateId = application.candidate?._id || application.candidate;
        const currentUserId = req.user._id || req.user.id;

        if (!candidateId || candidateId.toString() !== currentUserId.toString()) {
            const errorMsg = 'You are not authorized to withdraw this application.';
            if (req.xhr || req.headers.accept?.includes('application/json') || req.is('json')) {
                return res.status(403).json({ success: false, error: errorMsg });
            }
            if (req.flash) req.flash('error_msg', errorMsg);
            return res.redirect('/candidate/applications');
        }

        // Check if application is already in terminal or non-withdrawable state
        const currentStatus = application.status;
        const normalizedStatus = (currentStatus || '').toLowerCase();

        if (normalizedStatus === 'withdrawn') {
            const errorMsg = 'This application has already been withdrawn.';
            if (req.xhr || req.headers.accept?.includes('application/json') || req.is('json')) {
                return res.status(400).json({ success: false, error: errorMsg });
            }
            if (req.flash) req.flash('error_msg', errorMsg);
            return res.redirect('/candidate/applications');
        }

        if (['rejected', 'hired', 'accepted'].includes(normalizedStatus)) {
            const errorMsg = `Applications that are already ${currentStatus.toLowerCase()} cannot be withdrawn.`;
            if (req.xhr || req.headers.accept?.includes('application/json') || req.is('json')) {
                return res.status(400).json({ success: false, error: errorMsg });
            }
            if (req.flash) req.flash('error_msg', errorMsg);
            return res.redirect('/candidate/applications');
        }

        // Validate using schema method if present, or enforce permitted statuses
        if (typeof application.canWithdraw === 'function' && !application.canWithdraw()) {
            const errorMsg = `Application in '${currentStatus}' status cannot be withdrawn.`;
            if (req.xhr || req.headers.accept?.includes('application/json') || req.is('json')) {
                return res.status(400).json({ success: false, error: errorMsg });
            }
            if (req.flash) req.flash('error_msg', errorMsg);
            return res.redirect('/candidate/applications');
        }

        // Use the model's .withdraw() method to ensure statusHistory,
        // statusUpdatedAt, and interview cancellation are all handled.
        application.withdraw(reason || undefined);

        // Add audit entry in application notes
        if (Array.isArray(application.notes)) {
            application.notes.push({
                text: `[AUDIT] Application withdrawn by student.${reason ? ` Reason: "${reason}"` : ''}`,
                createdBy: req.user._id,
                createdAt: new Date()
            });
        }

        await application.save();

        // Trigger recruiter notification (non-blocking)
        if (application.internship) {
            notifyCandidateWithdrawal(application, application.internship);
        }

        const successMessage = 'Application withdrawn successfully.';

        if (req.xhr || req.headers.accept?.includes('application/json') || req.is('json')) {
            return res.status(200).json({
                success: true,
                message: successMessage,
                application: {
                    id: application._id,
                    status: application.status,
                    withdrawnAt: application.withdrawnAt,
                    withdrawalReason: application.withdrawalReason
                }
            });
        }

        if (req.flash) req.flash('success_msg', successMessage);
        const redirectUrl = req.get('Referrer')?.includes('my-applications') ? '/candidate/my-applications' : '/candidate/applications';
        return res.redirect(redirectUrl);

    } catch (error) {
        console.error('Error withdrawing application:', error);
        if (req.xhr || req.headers.accept?.includes('application/json') || req.is('json')) {
            return res.status(500).json({ success: false, error: 'Internal Server Error while withdrawing application.' });
        }
        if (req.flash) req.flash('error_msg', 'Failed to withdraw application. Please try again.');
        return res.redirect('/candidate/applications');
    }
}

// POST /candidate/applications/:id/withdraw
router.post('/candidate/applications/:id/withdraw', isAuthenticated, authorize('candidate'), handleApplicationWithdrawal);

// PATCH /candidate/applications/:id/withdraw
router.patch('/candidate/applications/:id/withdraw', isAuthenticated, authorize('candidate'), handleApplicationWithdrawal);

module.exports = router;
module.exports.handleApplicationWithdrawal = handleApplicationWithdrawal;
