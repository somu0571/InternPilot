const express = require('express');
const router = express.Router();

const User = require('../models/User');
const Internship = require('../models/Internship');
const Application = require('../models/Application');
const { isAuthenticated, authorize } = require('../middleware/auth');
const { sendStatusUpdateEmail } = require('../utils/sendEmail');

router.get('/company/dashboard', isAuthenticated, authorize('company'), async (req, res) => {
    try {
        const companyName = req.user.companyDetails?.companyName || req.user.name;
        const internships = await Internship.find({ companyName }).sort({ _id: -1 });
        const internshipIds = internships.map(i => i._id);
        const totalApplicationsCount = await Application.countDocuments({ internship: { $in: internshipIds } });

        res.render('company/company-dashboard', {
            user: req.user,
            internships,
            totalApplicationsCount
        });
    } catch (error) {
        console.error('Error loading company dashboard:', error);
        res.status(500).send('Database Error');
    }
});

router.post('/company/internships/create', isAuthenticated, authorize('company'), async (req, res) => {
    try {
        const { title, sector, requiredSkills, minQualifications, monthlyStipend, vacancies, duration, district, state } = req.body;
        const companyName = req.user.companyDetails?.companyName || req.user.name;

        const skillsArray = requiredSkills
            ? requiredSkills.split(',').map(s => s.trim()).filter(Boolean)
            : [];

        await Internship.create({
            companyName,
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

router.get('/company/internships/:id/applicants', isAuthenticated, authorize('company'), async (req, res) => {
    try {
        const internshipId = req.params.id;

        const internship = await Internship.findById(internshipId);
        if (!internship) {
            return res.status(404).send('Internship posting not found.');
        }

        const applications = await Application.find({ internship: internshipId })
            .populate('candidate')
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

router.post('/company/applications/:id/status', isAuthenticated, authorize('company'), async (req, res) => {
    try {
        const { status } = req.body;
        const applicationId = req.params.id;

        const application = await Application.findById(applicationId)
            .populate('candidate')
            .populate('internship');

        if (!application) {
            return res.status(404).send('Application not found.');
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

router.get('/company/internships/edit/:id', isAuthenticated, authorize('company'), async (req, res) => {
    try {
        const internship = await Internship.findById(req.params.id);
        if (!internship) {
            return res.status(404).send('Internship not found.');
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

router.post('/company/internships/edit/:id', isAuthenticated, authorize('company'), async (req, res) => {
    try {
        const { title, sector, requiredSkills, minQualifications, monthlyStipend, vacancies, duration, district, state } = req.body;

        const skillsArray = requiredSkills
            ? requiredSkills.split(',').map(s => s.trim()).filter(Boolean)
            : [];

        await Internship.findByIdAndUpdate(req.params.id, {
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

        if (req.flash) req.flash('success_msg', 'Internship updated successfully!');
        res.redirect('/company/dashboard');
    } catch (error) {
        console.error('Error updating internship:', error);
        res.redirect('/company/dashboard');
    }
});

router.post('/company/internships/delete/:id', isAuthenticated, authorize('company'), async (req, res) => {
    try {
        await Internship.findByIdAndDelete(req.params.id);

        if (req.flash) req.flash('success_msg', 'Internship deleted successfully!');
        res.redirect('/company/dashboard');
    } catch (error) {
        console.error('Error deleting internship:', error);
        res.status(500).send('Database Error');
    }
});

module.exports = router;