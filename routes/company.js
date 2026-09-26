const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/User');
const Internship = require('../models/Internship');
const Application = require('../models/Application');
const { isAuthenticated, requireCompanyRole } = require('../middleware/auth');
const { logoUpload, uploadBufferToCloudinary } = require('../middleware/upload');
const { sendStatusUpdateEmail, sendInterviewScheduledEmail, sendInterviewRescheduledEmail, sendInterviewCancelledEmail } = require('../utils/sendEmail');
const { parseISTEndOfDay, parseISTDatetime } = require('../utils/dateUtils');
const {
    notifyRelevantCandidates,
    notifyApplicationStatusChange,
    notifyInterviewScheduled,
    notifyInterviewRescheduled,
    notifyInterviewCancelled
} = require('../utils/notifications');
const chatRouter = require('./chat');
const { logRecruiterActivity } = require('../utils/activityLogger');
const { buildRecruiterOverview } = require('../utils/dashboardStats');

function handleLogoUpload(fieldName) {
    return (req, res, next) => {
        logoUpload.single(fieldName)(req, res, (err) => {
            if (err) {
                const message = err.code === 'LIMIT_FILE_SIZE'
                    ? 'Logo image is too large. Maximum allowed size is 3MB.'
                    : (err.message || 'Logo upload failed.');
                if (req.flash) req.flash('error_msg', message);
                return res.redirect('/company/profile');
            }
            next();
        });
    };
}

function sanitizeWebsiteUrl(val) {
    const raw = (val || '').trim();
    if (!raw) return { url: '' };

    let urlToTest = raw;
    if (!/^https?:\/\//i.test(urlToTest)) {
        urlToTest = 'https://' + urlToTest;
    }

    try {
        const parsed = new URL(urlToTest);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { error: 'Website URL must use http:// or https://' };
        }
        if (!parsed.hostname || !parsed.hostname.includes('.')) {
            return { error: 'Please enter a valid website address (e.g. https://example.com).' };
        }
        return { url: parsed.toString() };
    } catch {
        return { error: 'Please enter a valid website URL.' };
    }
}

function sanitizeContactEmail(val) {
    const raw = (val || '').trim();
    if (!raw) return { email: '' };
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(raw)) {
        return { error: 'Please enter a valid contact email address.' };
    }
    return { email: raw.toLowerCase() };
}

const notifyPublishedInternship = (internship) => {
    if (typeof notifyRelevantCandidates === 'function') {
        notifyRelevantCandidates(internship).catch(err => {
            console.error('Failed to notify candidates for published internship:', err);
        });
    }
};

// Company Profile Management (GET: view/edit form)
router.get('/company/profile', isAuthenticated, requireCompanyRole(['company', 'recruiter']), async (req, res) => {
    try {
        const companyId = req.user.companyId || (req.user.role === 'company' ? req.user._id : null);
        const company = await User.findById(companyId);
        if (!company) {
            if (req.flash) req.flash('error_msg', 'Company account not found.');
            return res.redirect('/company/dashboard');
        }

        const companyInternshipsCount = await Internship.countDocuments({ companyId: company._id });

        res.render('company/company-profile', {
            user: req.user,
            company,
            companyDetails: company.companyDetails || {},
            companyInternshipsCount
        });
    } catch (error) {
        console.error('Error loading company profile page:', error);
        res.status(500).send('Database Error');
    }
});

// Company Profile Management (POST: update company details & logo)
router.post('/company/profile', isAuthenticated, requireCompanyRole(['company', 'recruiter']), handleLogoUpload('logo'), async (req, res) => {
    try {
        const {
            companyName,
            industry,
            description,
            website,
            location,
            contactEmail,
            contactPhone,
            contactInformation,
            companySize,
            cin,
            removeLogo
        } = req.body;

        const trimmedName = (companyName || '').trim();
        if (!trimmedName) {
            if (req.flash) req.flash('error_msg', 'Company name is required.');
            return res.redirect('/company/profile');
        }

        const sanitizedWeb = sanitizeWebsiteUrl(website);
        if (sanitizedWeb.error) {
            if (req.flash) req.flash('error_msg', sanitizedWeb.error);
            return res.redirect('/company/profile');
        }

        const sanitizedEmail = sanitizeContactEmail(contactEmail);
        if (sanitizedEmail.error) {
            if (req.flash) req.flash('error_msg', sanitizedEmail.error);
            return res.redirect('/company/profile');
        }

        const companyId = req.user.companyId || (req.user.role === 'company' ? req.user._id : null);
        const company = await User.findById(companyId);
        if (!company) {
            if (req.flash) req.flash('error_msg', 'Company account not found.');
            return res.redirect('/company/dashboard');
        }

        if (!company.companyDetails) {
            company.companyDetails = {};
        }

        if (req.file) {
            try {
                const result = await uploadBufferToCloudinary(req.file, 'internpilot/company_logos');
                company.companyDetails.logo = result.secure_url;
            } catch (uploadErr) {
                console.error('Error uploading logo to Cloudinary:', uploadErr);
                if (req.file.buffer) {
                    company.companyDetails.logo = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
                }
            }
        } else if (removeLogo === 'true') {
            company.companyDetails.logo = '';
        }

        const oldCompanyName = company.companyDetails.companyName || company.name;

        company.companyDetails.companyName = trimmedName;
        company.companyDetails.industry = (industry || '').trim();
        company.companyDetails.description = (description || '').trim();
        company.companyDetails.website = sanitizedWeb.url;
        company.companyDetails.location = (location || '').trim();
        company.companyDetails.contactEmail = sanitizedEmail.email;
        company.companyDetails.contactPhone = (contactPhone || '').trim();
        company.companyDetails.contactInformation = (contactInformation || '').trim();
        company.companyDetails.companySize = (companySize || '').trim();

        if (cin && (req.user.role === 'company' || req.user.role === 'admin')) {
            company.companyDetails.cin = cin.trim();
        }

        await company.save();

        // Synchronize updated company name on all internships posted by this company
        if (trimmedName && trimmedName !== oldCompanyName) {
            await Internship.updateMany(
                { companyId: company._id },
                { $set: { companyName: trimmedName } }
            );
        }

        if (req.flash) req.flash('success_msg', 'Company profile updated successfully!');
        res.redirect('/company/profile');
    } catch (error) {
        console.error('Error updating company profile:', error);
        if (req.flash) req.flash('error_msg', 'Failed to update company profile. Please try again.');
        res.redirect('/company/profile');
    }
});

// Public Company Profile View (Accessible to all students/visitors)
router.get(['/company/:id/profile', '/company/profile/:id'], async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || id === 'edit') {
            return res.redirect('/company/dashboard');
        }

        if (!mongoose.Types.ObjectId.isValid(id)) {
            if (req.flash) req.flash('error_msg', 'Invalid company ID.');
            return res.redirect('/internships');
        }

        let company = await User.findById(id);
        if (!company) {
            if (req.flash) req.flash('error_msg', 'Company profile not found.');
            return res.redirect('/internships');
        }

        // If ID belongs to a recruiter account, resolve to their parent company
        if (company.role === 'recruiter' && company.companyId) {
            const parentCompany = await User.findById(company.companyId);
            if (parentCompany) {
                company = parentCompany;
            }
        }

        // Fetch all active/published internships by this company
        const internships = await Internship.find({
            companyId: company._id,
            status: 'published'
        }).sort({ _id: -1 });

        const isCompanyOwnerOrRecruiter = req.user && (
            req.user.role === 'admin' ||
            ((req.user.role === 'company' || req.user.role === 'recruiter') &&
             req.user.companyId && req.user.companyId.toString() === company._id.toString())
        );

        res.render('company/public-profile', {
            company,
            companyDetails: company.companyDetails || {},
            internships,
            currentUser: req.user,
            isCompanyOwnerOrRecruiter
        });
    } catch (error) {
        console.error('Error loading public company profile:', error);
        res.status(500).send('Database Error');
    }
});

router.get('/company/dashboard', isAuthenticated, requireCompanyRole(['company', 'recruiter']), async (req, res) => {
    try {
        const currentFilter = req.query.status || 'all'; // 'all', 'published', 'paused', 'draft'
        const currentSort = req.query.sort || 'newest';
        const allInternships = await Internship.find({ companyId: req.user.companyId }).sort({ _id: -1 });

        const publishedCount = allInternships.filter(i => (i.status === 'published' || (!i.status && !i.isPaused)) && !i.isPaused && i.status !== 'paused').length;
        const pausedCount = allInternships.filter(i => i.status === 'paused' || i.isPaused).length;
        const draftCount = allInternships.filter(i => i.status === 'draft').length;
        const totalCount = allInternships.length;

        let filteredInternships = allInternships;
        if (currentFilter === 'published') {
            filteredInternships = allInternships.filter(i => (i.status === 'published' || (!i.status && !i.isPaused)) && !i.isPaused && i.status !== 'paused');
        } else if (currentFilter === 'paused') {
            filteredInternships = allInternships.filter(i => i.status === 'paused' || i.isPaused);
        } else if (currentFilter === 'draft') {
            filteredInternships = allInternships.filter(i => i.status === 'draft');
        }

        const allInternshipIds = allInternships.map(i => i._id);
        const [totalApplicationsCount, applicationCounts] = await Promise.all([
            Application.countDocuments({ internship: { $in: allInternshipIds } }),
            Application.aggregate([
                { $match: { internship: { $in: allInternshipIds } } },
                { $group: { _id: '$internship', count: { $sum: 1 } } }
            ])
        ]);

        const appCountMap = {};
        applicationCounts.forEach(item => {
            appCountMap[item._id.toString()] = item.count;
        });

        if (currentSort === 'oldest') {
            filteredInternships.sort((a, b) => {
                const timeDiff = a._id.getTimestamp() - b._id.getTimestamp();
                if (timeDiff !== 0) return timeDiff;
                return a._id.toString().localeCompare(b._id.toString());
            });
        } else if (currentSort === 'most_applications' || currentSort === 'applications' || currentSort === 'applications_desc') {
            filteredInternships.sort((a, b) => {
                const countA = appCountMap[a._id.toString()] || 0;
                const countB = appCountMap[b._id.toString()] || 0;
                if (countB !== countA) return countB - countA;
                const timeDiff = b._id.getTimestamp() - a._id.getTimestamp();
                if (timeDiff !== 0) return timeDiff;
                return b._id.toString().localeCompare(a._id.toString());
            });
        } else if (currentSort === 'deadline' || currentSort === 'deadline_soonest' || currentSort === 'deadline_asc') {
            filteredInternships.sort((a, b) => {
                const deadlineA = a.applicationDeadline ? new Date(a.applicationDeadline).getTime() : Infinity;
                const deadlineB = b.applicationDeadline ? new Date(b.applicationDeadline).getTime() : Infinity;
                if (deadlineA !== deadlineB) return deadlineA - deadlineB;
                const timeDiff = b._id.getTimestamp() - a._id.getTimestamp();
                if (timeDiff !== 0) return timeDiff;
                return b._id.toString().localeCompare(a._id.toString());
            });
        } else {
            // Default: newest
            filteredInternships.sort((a, b) => {
                const timeDiff = b._id.getTimestamp() - a._id.getTimestamp();
                if (timeDiff !== 0) return timeDiff;
                return b._id.toString().localeCompare(a._id.toString());
            });
        }

        const overview = await buildRecruiterOverview(req.user.companyId);

        res.render('company/company-dashboard', {
            user: req.user,
            internships: filteredInternships,
            totalApplicationsCount,
            publishedCount,
            pausedCount,
            draftCount,
            totalCount,
            currentFilter,
            currentSort,
            appCountMap,
            overview
        });
    } catch (error) {
        console.error('Error loading company dashboard:', error);
        res.status(500).send('Database Error');
    }
});

router.post('/company/internships/create', isAuthenticated, requireCompanyRole(['company', 'recruiter']), async (req, res) => {
    try {
        const { title, sector, requiredSkills, minQualifications, monthlyStipend, stipend, vacancies, duration, district, state, location, deadline, action, description, responsibilities: responsibilitiesRaw, eligibilityCriteria: eligibilityRaw } = req.body;


        const isDraft = action === 'draft';
        const status = isDraft ? 'draft' : 'published';

        let applicationDeadline;
        try {
            applicationDeadline = parseISTEndOfDay(deadline);
        } catch (err) {
            if (req.flash) req.flash('error_msg', err.message || 'Invalid deadline date provided.');
            return res.redirect('/company/dashboard');
        }

        let companyName = req.user.companyDetails?.companyName;
        if (!companyName) {
             const accountOwner = await User.findById(req.user.companyId);
             companyName = accountOwner?.companyDetails?.companyName || accountOwner?.name || req.user.name;
        }

        const trimmedTitle = title && typeof title === 'string' ? title.trim() : '';
        if (!isDraft && !trimmedTitle) {
            if (req.flash) req.flash('error_msg', 'Internship title is required to publish an opportunity.');
            return res.redirect('/company/dashboard');
        }

        const resolvedTitle = trimmedTitle || (isDraft ? 'Untitled Draft' : 'Internship Opportunity');


        const skillsArray = requiredSkills
            ? requiredSkills.split(',').map(s => s.trim()).filter(Boolean)
            : [];

        let resolvedDistrict = district || '';
        let resolvedState = state || '';
        if ((!resolvedDistrict && !resolvedState) && location) {
            const locParts = location.split(',');
            resolvedDistrict = locParts[0] ? locParts[0].trim() : '';
            resolvedState = locParts[1] ? locParts[1].trim() : '';
        }
        const rawStipend = monthlyStipend !== undefined ? monthlyStipend : stipend;
        const stipendNumber = rawStipend ? parseInt(rawStipend.toString().replace(/[^0-9]/g, '')) : (isDraft ? 0 : 5000);

        const parseLines = (raw) => (raw ? raw.split('\n').map(s => s.trim()).filter(Boolean) : []);

        const internship = await Internship.create({
            companyId: req.user.companyId,
            postedBy: req.user._id,
            companyName,
            title: resolvedTitle,
            status,
            sector: sector || (isDraft ? 'Uncategorized' : 'General'),
            minQualifications: minQualifications || (isDraft ? '' : 'Any'),
            requiredSkills: skillsArray,
            monthlyStipend: stipendNumber,
            vacancies: vacancies ? Number(vacancies) : 1,
            duration: duration || (isDraft ? '' : '12 Months'),
            description: description || '',
            responsibilities: parseLines(responsibilitiesRaw),
            eligibilityCriteria: parseLines(eligibilityRaw),

            location: {
                district: resolvedDistrict,
                state: resolvedState
            },
            applicationDeadline
        });


        logRecruiterActivity(req, {
            action: 'CREATE_LISTING',
            targetType: 'Listing',
            targetId: internship._id,
            targetName: internship.title
        });

        if (status === 'published') {
            notifyPublishedInternship(internship);
        }

        if (req.flash) {
            if (isDraft) {
                req.flash('success_msg', 'Draft saved successfully! You can review, edit, and publish it anytime.');
            } else {
                req.flash('success_msg', 'Internship posted successfully!');
            }
        }
        res.redirect('/company/dashboard');
    } catch (error) {
        console.error('Error creating internship:', error);
        res.redirect('/company/dashboard');
    }
});

router.get('/company/internships/:id/applicants', isAuthenticated, requireCompanyRole(['company', 'recruiter']), async (req, res) => {
    try {
        const internshipId = req.params.id;

        const internship = await Internship.findById(internshipId);
        if (!internship) {
            return res.status(404).send('Internship posting not found.');
        }

        const companyName = req.user.companyDetails?.companyName || req.user.name;
        const isAuthorizedCompany = (internship.companyId && req.user.companyId && internship.companyId.toString() === req.user.companyId.toString()) ||
            (internship.postedBy && internship.postedBy.toString() === req.user._id.toString()) ||
            (internship.companyName === companyName);

        if (!isAuthorizedCompany) {
            if (req.flash) req.flash('error_msg', 'You are not authorized to view applicants for this internship.');
            return res.redirect('/company/dashboard');
        }

        const applications = await Application.find({ internship: internshipId })
            .populate('candidate')
            .populate('notes.createdBy')
            .sort({ _id: -1 });

        res.render('company/company-applicants', {
            user: req.user,
            internship,
            applications
        });
    } catch (error) {
        console.error('Error fetching applicants:', error);
        res.status(500).send('Database Error');
    }
});

router.post('/company/applications/:id/notes', isAuthenticated, requireCompanyRole(['company', 'recruiter']), async (req, res) => {
    try {
        const { text } = req.body;
        const applicationId = req.params.id;

        const application = await Application.findById(applicationId).populate('internship');
        if (!application) {
            return res.status(404).send('Application not found.');
        }

        const companyName = req.user.companyDetails?.companyName || req.user.name;
        const internship = application.internship;
        const isAuthorizedCompany = internship && (
            (internship.companyId && req.user.companyId && internship.companyId.toString() === req.user.companyId.toString()) ||
            (internship.postedBy && internship.postedBy.toString() === req.user._id.toString()) ||
            (internship.companyName === companyName)
        );

        if (!isAuthorizedCompany) {
            if (req.flash) req.flash('error_msg', 'You are not authorized to manage notes for this application.');
            return res.redirect('/company/dashboard');
        }

        const internshipId = internship._id || internship;

        if (!text || !text.trim()) {
            if (req.flash) req.flash('error_msg', 'Note text cannot be empty.');
            return res.redirect(`/company/internships/${internshipId}/applicants`);
        }

        application.notes.push({
            text: text.trim(),
            createdBy: req.user._id
        });
        await application.save();

        if (previousStatus !== status) {
            logRecruiterActivity(req, {
                action: status === 'Shortlisted' ? 'SHORTLIST_CANDIDATE' : 'UPDATE_APPLICATION_STATUS',
                targetType: 'Candidate',
                targetId: application.candidate._id,
                targetName: application.candidate.name || 'Candidate'
            });
        }

        if (req.flash) req.flash('success_msg', 'Note added successfully!');
        res.redirect(`/company/internships/${internshipId}/applicants`);
    } catch (error) {
        console.error('Error adding note:', error);
        res.status(500).send('Database Error');
    }
});

router.post('/company/applications/:id/notes/:noteId/edit', isAuthenticated, requireCompanyRole(['company', 'recruiter']), async (req, res) => {
    try {
        const { text } = req.body;
        const { id: applicationId, noteId } = req.params;

        const application = await Application.findById(applicationId).populate('internship');
        if (!application) {
            return res.status(404).send('Application not found.');
        }

        const companyName = req.user.companyDetails?.companyName || req.user.name;
        const internship = application.internship;
        const isAuthorizedCompany = internship && (
            (internship.companyId && req.user.companyId && internship.companyId.toString() === req.user.companyId.toString()) ||
            (internship.postedBy && internship.postedBy.toString() === req.user._id.toString()) ||
            (internship.companyName === companyName)
        );

        if (!isAuthorizedCompany) {
            if (req.flash) req.flash('error_msg', 'You are not authorized to edit notes for this application.');
            return res.redirect('/company/dashboard');
        }

        const internshipId = internship._id || internship;
        const note = application.notes.id(noteId);

        if (!note) {
            if (req.flash) req.flash('error_msg', 'Note not found.');
            return res.redirect(`/company/internships/${internshipId}/applicants`);
        }

        if (!note.createdBy || note.createdBy.toString() !== req.user._id.toString()) {
            if (req.flash) req.flash('error_msg', 'You are not authorized to edit this note.');
            return res.redirect(`/company/internships/${internshipId}/applicants`);
        }

        if (!text || !text.trim()) {
            if (req.flash) req.flash('error_msg', 'Note text cannot be empty.');
            return res.redirect(`/company/internships/${internshipId}/applicants`);
        }

        note.text = text.trim();
        note.updatedAt = new Date();
        await application.save();

        if (req.flash) req.flash('success_msg', 'Note updated successfully!');
        res.redirect(`/company/internships/${internshipId}/applicants`);
    } catch (error) {
        console.error('Error updating note:', error);
        res.status(500).send('Database Error');
    }
});

router.post('/company/applications/:id/notes/:noteId/delete', isAuthenticated, requireCompanyRole(['company', 'recruiter']), async (req, res) => {
    try {
        const { id: applicationId, noteId } = req.params;

        const application = await Application.findById(applicationId).populate('internship');
        if (!application) {
            return res.status(404).send('Application not found.');
        }

        const companyName = req.user.companyDetails?.companyName || req.user.name;
        const internship = application.internship;
        const isAuthorizedCompany = internship && (
            (internship.companyId && req.user.companyId && internship.companyId.toString() === req.user.companyId.toString()) ||
            (internship.postedBy && internship.postedBy.toString() === req.user._id.toString()) ||
            (internship.companyName === companyName)
        );

        if (!isAuthorizedCompany) {
            if (req.flash) req.flash('error_msg', 'You are not authorized to delete notes for this application.');
            return res.redirect('/company/dashboard');
        }

        const internshipId = internship._id || internship;
        const note = application.notes.id(noteId);

        if (!note) {
            if (req.flash) req.flash('error_msg', 'Note not found.');
            return res.redirect(`/company/internships/${internshipId}/applicants`);
        }

        if (!note.createdBy || note.createdBy.toString() !== req.user._id.toString()) {
            if (req.flash) req.flash('error_msg', 'You are not authorized to delete this note.');
            return res.redirect(`/company/internships/${internshipId}/applicants`);
        }

        application.notes.pull(noteId);
        await application.save();

        if (req.flash) req.flash('success_msg', 'Note deleted successfully!');
        res.redirect(`/company/internships/${internshipId}/applicants`);
    } catch (error) {
        console.error('Error deleting note:', error);
        res.status(500).send('Database Error');
    }
});

router.post('/company/applications/:id/status', isAuthenticated, requireCompanyRole(['company', 'recruiter']), async (req, res) => {
    try {
        const { status } = req.body;
        const applicationId = req.params.id;

        const allowedStatuses = ['Submitted', 'Under Review', 'Shortlisted', 'Rejected'];
        if (!status || !allowedStatuses.includes(status)) {
            if (req.flash) req.flash('error_msg', 'Invalid application status provided.');
            return res.redirect('/company/dashboard');
        }

        const application = await Application.findById(applicationId)
            .populate('candidate')
            .populate('internship');

        if (!application || !application.internship) {
            return res.status(404).send('Application not found.');
        }

        const internship = application.internship;
        const companyName = req.user.companyDetails?.companyName || req.user.name;
        const isAuthorizedCompany = (internship.companyId && req.user.companyId && internship.companyId.toString() === req.user.companyId.toString()) ||
            (internship.postedBy && internship.postedBy.toString() === req.user._id.toString()) ||
            (internship.companyName === companyName);

        if (!isAuthorizedCompany) {
            if (req.flash) req.flash('error_msg', 'Unauthorized to modify status for this application.');
            return res.redirect('/company/dashboard');
        }

        if (application.status === 'Withdrawn' || application.status === 'withdrawn') {
            if (req.flash) req.flash('error_msg', 'Cannot modify status: This candidate has already withdrawn their application.');
            const referrer = req.get('Referrer');
            return res.redirect(referrer || `/company/internships/${internship._id}/applicants`);
        }

        const previousStatus = application.status;
        // The Application pre-save hook records statusUpdatedAt only when this
        // assignment represents an actual status transition.
        application.status = status;
        await application.save();

        if (previousStatus !== status) {
            try {
                await notifyApplicationStatusChange(application, application.internship, status);
            } catch (notificationError) {
                console.error('Failed to create application status notification:', notificationError);
            }
        }

        if (previousStatus !== status && application.candidate?.email) {
            try {
                const candidateName = application.candidate.name || 'Candidate';
                const internshipTitle = application.internship?.title || 'Internship';

                await sendStatusUpdateEmail(
                    application.candidate.email,
                    candidateName,
                    internshipTitle,
                    status
                );
            } catch (emailErr) {
                console.error('Failed to send status update email:', emailErr);
            }
        }

        if (req.flash) req.flash('success_msg', `Application marked as ${status}`);
        const referrer = req.get('Referrer');
        if (referrer) {
            try {
                const refUrl = new URL(referrer, `${req.protocol}://${req.get('host')}`);
                if (refUrl.host === req.get('host') && refUrl.pathname.startsWith('/company/')) {
                    return res.redirect(refUrl.pathname + refUrl.search);
                }
            } catch (_) { /* malformed referrer — fall through */ }
        }
        res.redirect(`/company/internships/${application.internship._id}/applicants`);
    } catch (error) {
        console.error('Error updating status:', error);
        res.status(500).send('Database Error');
    }
});

router.get('/company/internships/edit/:id', isAuthenticated, requireCompanyRole(['company', 'recruiter']), async (req, res) => {
    try {
        const internship = await Internship.findOne({ _id: req.params.id, companyId: req.user.companyId });
        if (!internship) {
            return res.status(404).send('Internship not found or unauthorized.');
        }

        res.render('company/edit-internship', {
            user: req.user,
            internship
        });
    } catch (error) {
        console.error('Error loading edit form:', error);
        res.status(500).send('Database Error');
    }
});

router.post('/company/internships/edit/:id', isAuthenticated, requireCompanyRole(['company', 'recruiter']), async (req, res) => {
    try {
        const internship = await Internship.findOne({ _id: req.params.id, companyId: req.user.companyId });
        if (!internship) return res.status(404).send('Internship not found or unauthorized.');

        const { title, sector, requiredSkills, minQualifications, monthlyStipend, vacancies, duration, district, state, deadline, action, description, responsibilities: responsibilitiesRaw, eligibilityCriteria: eligibilityRaw } = req.body;

        const isDraft = action === 'draft';
        const isPublish = action === 'publish' || action === 'resume';
        const isPause = action === 'pause';
        const trimmedTitle = title && typeof title === 'string' ? title.trim() : '';
        const parsedVacancies = parseInt(vacancies);

        if (deadline !== undefined) {
            try {
                internship.applicationDeadline = parseISTEndOfDay(deadline);
            } catch (err) {
                if (req.flash) req.flash('error_msg', err.message || 'Invalid deadline date provided.');
                return res.redirect(`/company/internships/edit/${internship._id}`);
            }
        }

        const parseLines = (raw) => (raw ? raw.split('\n').map(s => s.trim()).filter(Boolean) : []);

        const skillsArray = requiredSkills
            ? requiredSkills.split(',').map(s => s.trim()).filter(Boolean)
            : [];

        internship.title = trimmedTitle || (isDraft ? 'Untitled Draft' : (internship.title || 'Internship Opportunity'));
        internship.sector = sector || (isDraft ? (internship.sector || 'Uncategorized') : 'General');
        internship.minQualifications = minQualifications || (isDraft ? '' : 'Any');
        internship.requiredSkills = skillsArray;
        internship.monthlyStipend = monthlyStipend !== undefined && monthlyStipend !== '' ? Number(monthlyStipend) : 0;
        internship.vacancies = isNaN(parsedVacancies) ? 1 : parsedVacancies;
        internship.duration = duration || '12 Months';
        internship.description = description || '';
        internship.responsibilities = parseLines(responsibilitiesRaw);
        internship.eligibilityCriteria = parseLines(eligibilityRaw);
        internship.location = {
            district: district || '',
            state: state || ''
        };



        const prevStatus = internship.status;
        if (isPublish) {
            internship.status = 'published';
            internship.isPaused = false;
        } else if (isPause) {
            internship.status = 'paused';
            internship.isPaused = true;
        } else if (isDraft) {
            internship.status = 'draft';
            internship.isPaused = false;
        }

        await internship.save();

        logRecruiterActivity(req, {
            action: isPause ? 'PAUSE_LISTING' : (isPublish ? 'PUBLISH_LISTING' : 'EDIT_LISTING'),
            targetType: 'Listing',
            targetId: internship._id,
            targetName: internship.title
        });

        if (prevStatus !== 'published' && internship.status === 'published') {
            notifyPublishedInternship(internship);
        }

        if (prevStatus !== internship.status && typeof chatRouter !== 'undefined' && typeof chatRouter.invalidateChatCache === 'function') {
            chatRouter.invalidateChatCache();
        }

        if (req.flash) {
            if (isPublish) {
                req.flash('success_msg', 'Opportunity published successfully! It is now live.');
            } else if (isPause) {
                req.flash('success_msg', 'Internship updated and applications are now paused.');
            } else if (isDraft) {
                req.flash('success_msg', 'Draft updated successfully!');
            } else {
                req.flash('success_msg', 'Internship updated successfully!');
            }
        }
        res.redirect('/company/dashboard');
    } catch (error) {
        console.error('Error updating internship:', error);
        res.redirect('/company/dashboard');
    }
});

router.post('/company/internships/publish/:id', isAuthenticated, requireCompanyRole(['company', 'recruiter']), async (req, res) => {
    try {
        const internship = await Internship.findOne({ _id: req.params.id, companyId: req.user.companyId });
        if (!internship) return res.status(404).send('Internship not found or unauthorized.');

        if (!internship.title || internship.title.trim() === '' || internship.title === 'Untitled Draft') {
            if (req.flash) req.flash('error_msg', 'Please set a valid title before publishing this draft.');
            return res.redirect(`/company/internships/edit/${internship._id}`);
        }

        const vacancies = Number(internship.vacancies);
        if (isNaN(vacancies) || vacancies < 1) {
            if (req.flash) req.flash('error_msg', 'Vacancies must be at least 1 to publish.');
            return res.redirect(`/company/internships/edit/${internship._id}`);
        }

        const previousStatus = internship.status;
        internship.status = 'published';
        internship.isPaused = false;
        await internship.save();

        logRecruiterActivity(req, {
            action: 'PUBLISH_LISTING',
            targetType: 'Listing',
            targetId: internship._id,
            targetName: internship.title
        });

        if (previousStatus !== 'published') {
            notifyPublishedInternship(internship);
        }

        if (typeof chatRouter !== 'undefined' && typeof chatRouter.invalidateChatCache === 'function') {
            chatRouter.invalidateChatCache();
        }

        if (req.flash) req.flash('success_msg', 'Internship published successfully! It is now live for candidates.');
        res.redirect('/company/dashboard');
    } catch (error) {
        console.error('Error publishing internship draft:', error);
        res.redirect('/company/dashboard');
    }
});

// Pause applications for an internship
const handlePause = async (req, res) => {
    try {
        const internship = await Internship.findOne({ _id: req.params.id, companyId: req.user.companyId });
        if (!internship) return res.status(404).send('Internship not found or unauthorized.');

        if (internship.status === 'draft') {
            if (req.flash) req.flash('error_msg', 'Cannot pause a draft internship. Publish it first.');
            return res.redirect('/company/dashboard');
        }

        internship.status = 'paused';
        internship.isPaused = true;
        await internship.save();

        logRecruiterActivity(req, {
            action: 'PAUSE_LISTING',
            targetType: 'Listing',
            targetId: internship._id,
            targetName: internship.title
        });

        if (typeof chatRouter.invalidateChatCache === 'function') {
            chatRouter.invalidateChatCache();
        }

        const msg = `Applications for "${internship.title}" are now temporarily paused.`;
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.json({ success: true, isPaused: true, status: 'paused', message: msg });
        }
        if (req.flash) req.flash('success_msg', msg);
        const referrer = req.get('Referrer');
        res.redirect(referrer || '/company/dashboard');
    } catch (error) {
        console.error('Error pausing internship:', error);
        res.status(500).send('Database Error');
    }
};

// Resume applications for an internship
const handleResume = async (req, res) => {
    try {
        const internship = await Internship.findOne({ _id: req.params.id, companyId: req.user.companyId });
        if (!internship) return res.status(404).send('Internship not found or unauthorized.');

        internship.status = 'published';
        internship.isPaused = false;
        await internship.save();

        logRecruiterActivity(req, {
            action: 'RESUME_LISTING',
            targetType: 'Listing',
            targetId: internship._id,
            targetName: internship.title
        });

        if (typeof chatRouter.invalidateChatCache === 'function') {
            chatRouter.invalidateChatCache();
        }

        const msg = `Applications for "${internship.title}" have been resumed! New candidates can apply now.`;
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.json({ success: true, isPaused: false, status: 'published', message: msg });
        }
        if (req.flash) req.flash('success_msg', msg);
        const referrer = req.get('Referrer');
        res.redirect(referrer || '/company/dashboard');
    } catch (error) {
        console.error('Error resuming internship:', error);
        res.status(500).send('Database Error');
    }
};

// Toggle pause status for an internship
const handleTogglePause = async (req, res) => {
    try {
        const internship = await Internship.findOne({ _id: req.params.id, companyId: req.user.companyId });
        if (!internship) return res.status(404).send('Internship not found or unauthorized.');

        if (internship.status === 'draft') {
            if (req.flash) req.flash('error_msg', 'Cannot pause a draft internship. Publish it first.');
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

        logRecruiterActivity(req, {
            action: willPause ? 'PAUSE_LISTING' : 'RESUME_LISTING',
            targetType: 'Listing',
            targetId: internship._id,
            targetName: internship.title
        });

        if (typeof chatRouter.invalidateChatCache === 'function') {
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
    } catch (error) {
        console.error('Error toggling pause on internship:', error);
        res.status(500).send('Database Error');
    }
};

router.post('/company/internships/:id/pause', isAuthenticated, requireCompanyRole(['company', 'recruiter']), handlePause);
router.post('/company/internships/pause/:id', isAuthenticated, requireCompanyRole(['company', 'recruiter']), handlePause);
router.post('/company/internships/:id/resume', isAuthenticated, requireCompanyRole(['company', 'recruiter']), handleResume);
router.post('/company/internships/resume/:id', isAuthenticated, requireCompanyRole(['company', 'recruiter']), handleResume);
router.post('/company/internships/:id/toggle-pause', isAuthenticated, requireCompanyRole(['company', 'recruiter']), handleTogglePause);
router.post('/company/internships/toggle-pause/:id', isAuthenticated, requireCompanyRole(['company', 'recruiter']), handleTogglePause);

router.post('/company/internships/delete/:id', isAuthenticated, requireCompanyRole(['company', 'recruiter']), async (req, res) => {
    try {
        const internship = await Internship.findOneAndDelete({ _id: req.params.id, companyId: req.user.companyId });
        if (!internship) return res.status(404).send('Internship not found or unauthorized.');

        // Clean up orphaned applications for this deleted internship
        await Application.deleteMany({ internship: req.params.id });

        logRecruiterActivity(req, {
            action: 'DELETE_LISTING',
            targetType: 'Listing',
            targetId: internship._id,
            targetName: internship.title
        });

        if (req.flash) req.flash('success_msg', 'Internship deleted successfully!');
        res.redirect('/company/dashboard');
    } catch (error) {
        console.error('Error deleting internship:', error);
        res.status(500).send('Database Error');
    }
});

// --- Team Management Routes ---

router.get('/company/team', isAuthenticated, requireCompanyRole(['company']), async (req, res) => {
    try {
        const teamMembers = await User.find({
            companyId: req.user.companyId,
            role: 'recruiter',
            isActive: true
        }).sort({ createdAt: -1 });

        res.render('company/company-team', {
            user: req.user,
            teamMembers
        });
    } catch (error) {
        console.error('Error loading team page:', error);
        res.status(500).send('Database Error');
    }
});

router.post('/company/team/add', isAuthenticated, requireCompanyRole(['company']), async (req, res) => {
    try {
        const { name, email, password } = req.body;

        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            if (req.flash) req.flash('error_msg', 'Email is already registered.');
            return res.redirect('/company/team');
        }

        const recruiter = await User.create({
            name,
            email: email.toLowerCase(),
            password,
            role: 'recruiter',
            companyId: req.user.companyId,
            isEmailVerified: true,
            isActive: true
        });

        logRecruiterActivity(req, {
            action: 'ADD_TEAM_MEMBER',
            targetType: 'Recruiter',
            targetId: recruiter._id,
            targetName: recruiter.name
        });

        if (req.flash) req.flash('success_msg', 'Recruiter added successfully!');
        res.redirect('/company/team');
    } catch (error) {
        console.error('Error adding recruiter:', error);
        if (req.flash) req.flash('error_msg', 'An error occurred while adding recruiter.');
        res.redirect('/company/team');
    }
});

router.post('/company/team/remove/:id', isAuthenticated, requireCompanyRole(['company']), async (req, res) => {
    try {
        const member = await User.findOne({ _id: req.params.id, companyId: req.user.companyId, role: 'recruiter' });
        if (!member) {
            if (req.flash) req.flash('error_msg', 'Recruiter not found.');
            return res.redirect('/company/team');
        }

        member.isActive = false;
        await member.save();

        logRecruiterActivity(req, {
            action: 'REMOVE_TEAM_MEMBER',
            targetType: 'Recruiter',
            targetId: member._id,
            targetName: member.name
        });

        if (req.flash) req.flash('success_msg', 'Recruiter deactivated successfully!');
        res.redirect('/company/team');
    } catch (error) {
        console.error('Error deactivating recruiter:', error);
        if (req.flash) req.flash('error_msg', 'An error occurred while deactivating recruiter.');
        res.redirect('/company/team');
    }
});

// --- Candidate Profile View (Read-Only for Recruiters) ---

router.get('/company/applications/:id/candidate', isAuthenticated, requireCompanyRole(['company', 'recruiter']), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            if (req.flash) req.flash('error_msg', 'Application not found.');
            return res.redirect('/company/dashboard');
        }

        const application = await Application.findById(req.params.id)
            .populate('candidate')
            .populate('internship');

        if (!application || !application.internship || !application.candidate) {
            if (req.flash) req.flash('error_msg', 'Application or candidate not found.');
            return res.redirect('/company/dashboard');
        }

        const internship = application.internship;
        const companyName = req.user.companyDetails?.companyName || req.user.name;
        const isAuthorizedCompany = (internship.companyId && req.user.companyId && internship.companyId.toString() === req.user.companyId.toString()) ||
            (internship.postedBy && internship.postedBy.toString() === req.user._id.toString()) ||
            (internship.companyName === companyName);

        if (!isAuthorizedCompany) {
            if (req.flash) req.flash('error_msg', 'You are not authorized to view this candidate profile.');
            return res.redirect('/company/dashboard');
        }

        res.render('company/candidate-profile-view', {
            user: req.user,
            application,
            candidate: application.candidate,
            internship
        });
    } catch (error) {
        console.error('Error loading candidate profile:', error);
        if (req.flash) req.flash('error_msg', 'Failed to load candidate profile.');
        res.redirect('/company/dashboard');
    }
});

// --- Interview Scheduling Routes ---

router.post('/company/applications/:id/interview/schedule', isAuthenticated, requireCompanyRole(['company', 'recruiter']), async (req, res) => {
    try {
        const { scheduledAt, duration, mode, meetingLink, location, instructions } = req.body;
        const application = await Application.findById(req.params.id).populate('candidate').populate('internship');

        if (!application || !application.internship) {
            if (req.flash) req.flash('error_msg', 'Application not found.');
            return res.redirect('/company/dashboard');
        }

        const internship = application.internship;
        const companyName = req.user.companyDetails?.companyName || req.user.name;
        const isAuthorizedCompany = (internship.companyId && req.user.companyId && internship.companyId.toString() === req.user.companyId.toString()) ||
            (internship.postedBy && internship.postedBy.toString() === req.user._id.toString()) ||
            (internship.companyName === companyName);

        if (!isAuthorizedCompany) {
            if (req.flash) req.flash('error_msg', 'Unauthorized access.');
            return res.redirect('/company/dashboard');
        }

        if (application.status === 'Rejected' || application.status === 'rejected') {
            if (req.flash) req.flash('error_msg', 'Cannot schedule interview for a rejected application.');
            return res.redirect(`/company/applications/${req.params.id}/candidate`);
        }

        if (application.interview && application.interview.status && application.interview.status !== 'Cancelled') {
            if (req.flash) req.flash('error_msg', 'An interview is already active. Please use the reschedule option.');
            return res.redirect(`/company/applications/${req.params.id}/candidate`);
        }

        if (mode === 'Online' && (!meetingLink || !meetingLink.trim())) {
            if (req.flash) req.flash('error_msg', 'Meeting link is required for Online interviews.');
            return res.redirect(`/company/applications/${req.params.id}/candidate`);
        }
        if (mode === 'In-Person' && (!location || !location.trim())) {
            if (req.flash) req.flash('error_msg', 'Location is required for In-Person interviews.');
            return res.redirect(`/company/applications/${req.params.id}/candidate`);
        }

        let parsedDate;
        try {
            parsedDate = parseISTDatetime(scheduledAt);
            if (parsedDate < new Date()) {
                throw new Error('Interview must be scheduled in the future.');
            }
        } catch (err) {
            if (req.flash) req.flash('error_msg', err.message);
            return res.redirect(`/company/applications/${req.params.id}/candidate`);
        }

        application.status = 'Interview';
        application.interview = {
            status: 'Scheduled',
            scheduledAt: parsedDate,
            duration: Number(duration) || 30,
            mode,
            meetingLink: mode === 'Online' ? meetingLink.trim() : '',
            location: mode === 'In-Person' ? location.trim() : '',
            instructions: instructions ? instructions.trim() : '',
            scheduledBy: req.user._id,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        await application.save();

        if (application.candidate?.email) {
            try {
                await sendInterviewScheduledEmail(
                    application.candidate.email,
                    application.candidate.name || 'Candidate',
                    internship.title,
                    application.interview
                );
            } catch (emailErr) {
                console.error('Failed to send interview email:', emailErr);
            }
        }

        try {
            await notifyInterviewScheduled(application, internship, parsedDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }));
        } catch (notifErr) {
            console.error('Failed to create interview scheduled notification:', notifErr);
        }

        if (req.flash) req.flash('success_msg', 'Interview scheduled successfully.');
        res.redirect(`/company/applications/${req.params.id}/candidate`);
    } catch (error) {
        console.error('Error scheduling interview:', error);
        if (req.flash) req.flash('error_msg', 'An error occurred while scheduling the interview.');
        res.redirect('/company/dashboard');
    }
});

router.post('/company/applications/:id/interview/reschedule', isAuthenticated, requireCompanyRole(['company', 'recruiter']), async (req, res) => {
    try {
        const { scheduledAt, duration, mode, meetingLink, location, instructions } = req.body;
        const application = await Application.findById(req.params.id).populate('candidate').populate('internship');

        if (!application || !application.internship) {
            return res.redirect('/company/dashboard');
        }

        const internship = application.internship;
        const companyName = req.user.companyDetails?.companyName || req.user.name;
        const isAuthorizedCompany = (internship.companyId && req.user.companyId && internship.companyId.toString() === req.user.companyId.toString()) ||
            (internship.postedBy && internship.postedBy.toString() === req.user._id.toString()) ||
            (internship.companyName === companyName);

        if (!isAuthorizedCompany) return res.redirect('/company/dashboard');

        if (!application.interview || !application.interview.status || application.interview.status === 'Cancelled') {
            if (req.flash) req.flash('error_msg', 'No active interview to reschedule.');
            return res.redirect(`/company/applications/${req.params.id}/candidate`);
        }

        if (mode === 'Online' && (!meetingLink || !meetingLink.trim())) {
            if (req.flash) req.flash('error_msg', 'Meeting link is required for Online interviews.');
            return res.redirect(`/company/applications/${req.params.id}/candidate`);
        }
        if (mode === 'In-Person' && (!location || !location.trim())) {
            if (req.flash) req.flash('error_msg', 'Location is required for In-Person interviews.');
            return res.redirect(`/company/applications/${req.params.id}/candidate`);
        }

        let parsedDate;
        try {
            parsedDate = parseISTDatetime(scheduledAt);
            if (parsedDate < new Date()) {
                throw new Error('Interview must be scheduled in the future.');
            }
        } catch (err) {
            if (req.flash) req.flash('error_msg', err.message);
            return res.redirect(`/company/applications/${req.params.id}/candidate`);
        }

        application.status = 'Interview';
        application.interview.status = 'Rescheduled';
        application.interview.scheduledAt = parsedDate;
        application.interview.duration = Number(duration) || 30;
        application.interview.mode = mode;
        application.interview.meetingLink = mode === 'Online' ? meetingLink.trim() : '';
        application.interview.location = mode === 'In-Person' ? location.trim() : '';
        application.interview.instructions = instructions ? instructions.trim() : '';
        application.interview.updatedAt = new Date();

        await application.save();

        if (application.candidate?.email) {
            try {
                await sendInterviewRescheduledEmail(
                    application.candidate.email,
                    application.candidate.name || 'Candidate',
                    internship.title,
                    application.interview
                );
            } catch (emailErr) {
                console.error('Failed to send interview rescheduled email:', emailErr);
            }
        }

        try {
            await notifyInterviewRescheduled(application, internship, parsedDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }));
        } catch (notifErr) {
            console.error('Failed to create interview rescheduled notification:', notifErr);
        }

        if (req.flash) req.flash('success_msg', 'Interview rescheduled successfully.');
        res.redirect(`/company/applications/${req.params.id}/candidate`);
    } catch (error) {
        console.error('Error rescheduling interview:', error);
        res.redirect('/company/dashboard');
    }
});

router.post('/company/applications/:id/interview/cancel', isAuthenticated, requireCompanyRole(['company', 'recruiter']), async (req, res) => {
    try {
        const { cancelReason } = req.body;
        const application = await Application.findById(req.params.id).populate('candidate').populate('internship');

        if (!application || !application.internship) return res.redirect('/company/dashboard');

        const internship = application.internship;
        const companyName = req.user.companyDetails?.companyName || req.user.name;
        const isAuthorizedCompany = (internship.companyId && req.user.companyId && internship.companyId.toString() === req.user.companyId.toString()) ||
            (internship.postedBy && internship.postedBy.toString() === req.user._id.toString()) ||
            (internship.companyName === companyName);

        if (!isAuthorizedCompany) return res.redirect('/company/dashboard');

        if (!application.interview || !application.interview.status || application.interview.status === 'Cancelled') {
            if (req.flash) req.flash('error_msg', 'No active interview to cancel.');
            return res.redirect(`/company/applications/${req.params.id}/candidate`);
        }

        application.interview.status = 'Cancelled';
        application.interview.cancelledAt = new Date();
        application.interview.cancelReason = cancelReason ? cancelReason.trim() : '';

        // As requested by user, we do NOT revert the application.status here. We leave it as 'Interview'.

        await application.save();

        if (application.candidate?.email) {
            try {
                await sendInterviewCancelledEmail(
                    application.candidate.email,
                    application.candidate.name || 'Candidate',
                    internship.title,
                    application.interview.cancelReason
                );
            } catch (emailErr) {
                console.error('Failed to send interview cancelled email:', emailErr);
            }
        }

        try {
            await notifyInterviewCancelled(application, internship);
        } catch (notifErr) {
            console.error('Failed to create interview cancelled notification:', notifErr);
        }

        if (req.flash) req.flash('success_msg', 'Interview cancelled successfully.');
        res.redirect(`/company/applications/${req.params.id}/candidate`);
    } catch (error) {
        console.error('Error cancelling interview:', error);
        res.redirect('/company/dashboard');
    }
});

// JSON feed the dashboard overview polls so its numbers stay current without
// a page reload.
router.get('/company/dashboard/overview', isAuthenticated, requireCompanyRole(['company', 'recruiter']), async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        res.json(await buildRecruiterOverview(req.user.companyId));
    } catch (error) {
        console.error('Error building recruiter overview:', error);
        res.status(500).json({ error: 'Could not load the overview.' });
    }
});

module.exports = router;
