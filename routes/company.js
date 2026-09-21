const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Internship = require('../models/Internship');
const Application = require('../models/Application');
const { isAuthenticated } = require('../middleware/auth');
const { sendStatusUpdateEmail } = require('../utils/sendEmail');
const {
    TEAM_MEMBER_ROLES,
    companyName,
    companyInternshipQuery,
    belongsToCompany,
    requireCompanyPermission
} = require('../middleware/companyAccess');

const APPLICATION_STATUSES = ['Submitted', 'Under Review', 'Shortlisted', 'Rejected'];

router.get('/company/dashboard', isAuthenticated, requireCompanyPermission('dashboard:view'), async (req, res) => {
    try {
        const internships = await Internship.find(companyInternshipQuery(req.company)).sort({ _id: -1 });
        const internshipIds = internships.map(i => i._id);
        const totalApplicationsCount = await Application.countDocuments({ internship: { $in: internshipIds } });

        res.render('company/company-dashboard', {
            user: req.user,
            internships,
            totalApplicationsCount,
            permissions: req.companyPermissions
        });
    } catch (error) {
        console.error('Error loading company dashboard:', error);
        res.status(500).send('Database Error');
    }
});

router.post('/company/internships/create', isAuthenticated, requireCompanyPermission('internship:create'), async (req, res) => {
    try {
        const { title, sector, requiredSkills, minQualifications, monthlyStipend, vacancies, duration, district, state } = req.body;

        const skillsArray = requiredSkills
            ? requiredSkills.split(',').map(s => s.trim()).filter(Boolean)
            : [];

        await Internship.create({
            companyId: req.company._id,
            postedBy: req.user._id,
            companyName: companyName(req.company),
            title,
            sector: sector || 'General',
            minQualifications: minQualifications || 'Any',
            requiredSkills: skillsArray,
            monthlyStipend: monthlyStipend ? Number(monthlyStipend) : 5000,
            vacancies: vacancies ? Number(vacancies) : 1,
            duration: duration || '12 Months',
            location: {
                district: district || '',
                state: state || ''
            }
        });

        if (req.flash) req.flash('success_msg', 'Internship posted successfully!');
        res.redirect('/company/dashboard');
    } catch (error) {
        console.error('Error creating internship:', error);
        res.redirect('/company/dashboard');
    }
});

router.get('/company/internships/:id/applicants', isAuthenticated, requireCompanyPermission('applications:view'), async (req, res) => {
    try {
        const internshipId = req.params.id;

        const internship = await Internship.findOne({ _id: internshipId, ...companyInternshipQuery(req.company) });
        if (!internship) {
            return res.status(404).send('Internship posting not found or unauthorized.');
        }

        const applications = await Application.find({ internship: internshipId })
            .populate('candidate')
            .sort({ _id: -1 });

        res.render('company/company-applicants', {
            user: req.user,
            internship,
            applications,
            permissions: req.companyPermissions
        });
    } catch (error) {
        console.error('Error fetching applicants:', error);
        res.status(500).send('Database Error');
    }
});

router.post('/company/applications/:id/status', isAuthenticated, requireCompanyPermission('applications:review'), async (req, res) => {
    try {
        const { status } = req.body;
        const applicationId = req.params.id;

        if (!APPLICATION_STATUSES.includes(status)) {
            if (req.flash) req.flash('error_msg', 'Invalid application status.');
            return res.redirect('/company/dashboard');
        }

        const application = await Application.findById(applicationId)
            .populate('candidate')
            .populate('internship');

        if (!application || !application.internship || !belongsToCompany(application.internship, req.company)) {
            return res.status(404).send('Application not found or unauthorized.');
        }

        const previousStatus = application.status;
        application.status = status;
        await application.save();

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
        res.redirect(`/company/internships/${application.internship._id}/applicants`);
    } catch (error) {
        console.error('Error updating status:', error);
        res.status(500).send('Database Error');
    }
});

router.get('/company/internships/edit/:id', isAuthenticated, requireCompanyPermission('internship:edit'), async (req, res) => {
    try {
        const internship = await Internship.findOne({ _id: req.params.id, ...companyInternshipQuery(req.company) });
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

router.post('/company/internships/edit/:id', isAuthenticated, requireCompanyPermission('internship:edit'), async (req, res) => {
    try {
        const internship = await Internship.findOne({ _id: req.params.id, ...companyInternshipQuery(req.company) });
        if (!internship) return res.status(404).send('Internship not found or unauthorized.');

        const { title, sector, requiredSkills, minQualifications, monthlyStipend, vacancies, duration, district, state } = req.body;

        const skillsArray = requiredSkills
            ? requiredSkills.split(',').map(s => s.trim()).filter(Boolean)
            : [];

        internship.title = title;
        internship.sector = sector || 'General';
        internship.minQualifications = minQualifications || 'Any';
        internship.requiredSkills = skillsArray;
        internship.monthlyStipend = monthlyStipend ? Number(monthlyStipend) : 5000;
        internship.vacancies = vacancies ? Number(vacancies) : 1;
        internship.duration = duration || '12 Months';
        internship.location = {
            district: district || '',
            state: state || ''
        };

        await internship.save();

        if (req.flash) req.flash('success_msg', 'Internship updated successfully!');
        res.redirect('/company/dashboard');
    } catch (error) {
        console.error('Error updating internship:', error);
        res.redirect('/company/dashboard');
    }
});

router.post('/company/internships/delete/:id', isAuthenticated, requireCompanyPermission('internship:delete'), async (req, res) => {
    try {
        const internship = await Internship.findOneAndDelete({ _id: req.params.id, ...companyInternshipQuery(req.company) });
        if (!internship) return res.status(404).send('Internship not found or unauthorized.');

        if (req.flash) req.flash('success_msg', 'Internship deleted successfully!');
        res.redirect('/company/dashboard');
    } catch (error) {
        console.error('Error deleting internship:', error);
        res.status(500).send('Database Error');
    }
});

// --- Team Management Routes ---

router.get('/company/team', isAuthenticated, requireCompanyPermission('team:manage'), async (req, res) => {
    try {
        const teamMembers = await User.find({
            companyId: req.company._id,
            role: { $in: TEAM_MEMBER_ROLES },
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

router.post('/company/team/add', isAuthenticated, requireCompanyPermission('team:manage'), async (req, res) => {
    try {
        const { name, email, password, role } = req.body;
        const teamRole = role || 'recruiter';

        if (!name?.trim() || !email?.trim() || !password || !TEAM_MEMBER_ROLES.includes(teamRole)) {
            if (req.flash) req.flash('error_msg', 'Enter a name, email, password, and valid team role.');
            return res.redirect('/company/team');
        }

        const normalizedEmail = email.trim().toLowerCase();
        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser) {
            if (req.flash) req.flash('error_msg', 'Email is already registered.');
            return res.redirect('/company/team');
        }

        await User.create({
            name: name.trim(),
            email: normalizedEmail,
            password,
            role: teamRole,
            companyId: req.company._id,
            isEmailVerified: true,
            isActive: true
        });

        if (req.flash) req.flash('success_msg', `${teamRole === 'hiring_manager' ? 'Hiring manager' : 'Recruiter'} added successfully!`);
        res.redirect('/company/team');
    } catch (error) {
        console.error('Error adding recruiter:', error);
        if (req.flash) req.flash('error_msg', 'An error occurred while adding recruiter.');
        res.redirect('/company/team');
    }
});

router.post('/company/team/remove/:id', isAuthenticated, requireCompanyPermission('team:manage'), async (req, res) => {
    try {
        const member = await User.findOne({
            _id: req.params.id,
            companyId: req.company._id,
            role: { $in: TEAM_MEMBER_ROLES }
        });
        if (!member) {
            if (req.flash) req.flash('error_msg', 'Team member not found.');
            return res.redirect('/company/team');
        }

        member.isActive = false;
        await member.save();

        if (req.flash) req.flash('success_msg', 'Recruiter deactivated successfully!');
        res.redirect('/company/team');
    } catch (error) {
        console.error('Error deactivating recruiter:', error);
        if (req.flash) req.flash('error_msg', 'An error occurred while deactivating recruiter.');
        res.redirect('/company/team');
    }
});

module.exports = router;
