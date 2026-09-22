const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Internship = require('../models/Internship');
const Application = require('../models/Application');
const { isAuthenticated, authorize } = require('../middleware/auth');

function calculateSkillScore(userSkills = [], requiredSkills = []) {
    if (!requiredSkills.length) return 100;
    const userSkillsLower = userSkills.map(s => s.toLowerCase());
    let matchCount = 0;
    requiredSkills.forEach(skill => {
        if (userSkillsLower.includes(skill.toLowerCase())) matchCount++;
    });
    return Math.round((matchCount / requiredSkills.length) * 100);
}

router.get('/', async (req, res) => {
    try {
        const internships = await Internship.find({}).sort({ _id: -1 });
        const candidate = req.user || await User.findOne();

        let appliedIds = [];
        if (candidate) {
            const apps = await Application.find({ candidate: candidate._id }).select('internship');
            appliedIds = apps.map(appDoc => appDoc.internship.toString());
        }

        res.render('extras/internships', { internships, candidate, appliedIds });
    } catch (error) {
        console.error('Error fetching internships:', error);
        res.status(500).send('Database Error');
    }
});

router.post('/new', isAuthenticated, authorize('company'), async (req, res) => {
    try {
        const { title, company: companyName, location, sector, stipend, vacancies, requiredSkills } = req.body;

        const locationParts = location ? location.split(',') : [];
        const district = locationParts[0] ? locationParts[0].trim() : '';
        const state = locationParts[1] ? locationParts[1].trim() : '';
        const stipendNumber = stipend ? parseInt(stipend.toString().replace(/[^0-9]/g, '')) : 5000;

        const newInternship = new Internship({
            title,
            companyName,
            sector,
            location: { district, state },
            monthlyStipend: stipendNumber,
            vacancies: vacancies ? parseInt(vacancies) : 1,
            requiredSkills: requiredSkills ? requiredSkills.split(',').map(s => s.trim()) : [],
            postedBy: req.user._id
        });

        await newInternship.save();
        req.flash('success_msg', 'Internship opportunity posted!');
        res.redirect('/internships');
    } catch (error) {
        console.error('Error saving internship:', error);
        res.status(500).send('Database Error');
    }
});

router.post('/:id/edit', isAuthenticated, authorize('company'), async (req, res) => {
    try {
        const internship = await Internship.findById(req.params.id);
        if (!internship) return res.status(404).send('Internship not found');

        if (req.user.role === 'company' && internship.postedBy && internship.postedBy.toString() !== req.user._id.toString()) {
            req.flash('error_msg', 'Unauthorized action.');
            return res.redirect('/internships');
        }

        const { title, company: companyName, location, sector, stipend, duration, vacancies, requiredSkills } = req.body;

        const locationParts = location ? location.split(',') : [];
        const district = locationParts[0] ? locationParts[0].trim() : '';
        const state = locationParts[1] ? locationParts[1].trim() : '';
        const stipendNumber = stipend ? parseInt(stipend.toString().replace(/[^0-9]/g, '')) : 5000;

        await Internship.findByIdAndUpdate(req.params.id, {
            title,
            companyName,
            sector,
            location: { district, state },
            monthlyStipend: stipendNumber,
            duration: duration || '12 Months',
            vacancies: parseInt(vacancies) || 1,
            requiredSkills: requiredSkills ? requiredSkills.split(',').map(s => s.trim()) : []
        });

        req.flash('success_msg', 'Internship updated successfully.');
        res.redirect('/internships');
    } catch (error) {
        console.error('Error updating internship:', error);
        res.status(500).send('Database Error');
    }
});

router.post('/:id/delete', isAuthenticated, authorize('company'), async (req, res) => {
    try {
        const internship = await Internship.findById(req.params.id);
        if (!internship) return res.status(404).send('Internship not found');

        if (req.user.role === 'company' && internship.postedBy && internship.postedBy.toString() !== req.user._id.toString()) {
            req.flash('error_msg', 'Unauthorized action.');
            return res.redirect('/internships');
        }

        await Internship.findByIdAndDelete(req.params.id);
        req.flash('success_msg', 'Internship removed.');
        res.redirect('/internships');
    } catch (error) {
        console.error('Error deleting internship:', error);
        res.status(500).send('Database Error');
    }
});

router.post('/:id/apply', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const candidate = req.user || await User.findOne();
        const internship = await Internship.findById(req.params.id);

        if (!candidate || !internship) {
            return res.status(404).send('Candidate or Internship not found');
        }

        const existingApp = await Application.findOne({
            internship: internship._id,
            candidate: candidate._id
        });

        if (existingApp) {
            req.flash('error_msg', 'You have already applied for this opportunity.');
            return res.redirect('/candidate/applications');
        }

        const score = calculateSkillScore(candidate.skills || [], internship.requiredSkills || []);

        await Application.create({
            internship: internship._id,
            candidate: candidate._id,
            matchScore: score
        });

        req.flash('success_msg', 'Application submitted successfully!');
        res.redirect('/candidate/applications');
    } catch (error) {
        console.error('Error applying for internship:', error);
        res.status(500).send('Database Error');
    }
});

router.get('/:id/applicants', isAuthenticated, authorize('company'), async (req, res) => {
    try {
        const internship = await Internship.findById(req.params.id);

        const applications = await Application.find({ internship: req.params.id })
            .populate('candidate')
            .sort({ matchScore: -1 });

        res.render('company/company-applicants', { internship, applications });
    } catch (error) {
        console.error('Error fetching applicants:', error);
        res.status(500).send('Database Error');
    }
});

module.exports = router;
