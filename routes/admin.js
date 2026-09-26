const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const User = require('../models/User');
const { isAuthenticated, authorize } = require('../middleware/auth');

router.get('/dashboard', isAuthenticated, authorize('admin'), async (req, res) => {
    try {
        const totalCandidates = await User.countDocuments({ role: 'candidate' });
        const totalCompanies = await User.countDocuments({ role: 'company' });

        const pendingCompanies = await User.find({
            role: 'company',
            $or: [
                { 'companyDetails.isVerified': false },
                { 'companyDetails.isVerified': { $exists: false } }
            ]
        });

        const allUsers = await User.find().sort({ createdAt: -1 }).limit(10);

        res.render('admin/dashboard', {
            user: req.user,
            stats: {
                candidates: totalCandidates,
                companies: totalCompanies,
                pendingVerifications: pendingCompanies.length
            },
            pendingCompanies,
            recentUsers: allUsers
        });
    } catch (err) {
        console.error('Error loading admin dashboard:', err);
        res.status(500).send('Server Error');
    }
});

router.post('/approve-company/:id', isAuthenticated, authorize('admin'), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            req.flash('error_msg', 'Invalid company ID.');
            return res.redirect('/admin/dashboard');
        }
        const result = await User.findOneAndUpdate(
            { _id: req.params.id, role: 'company' },
            { 'companyDetails.isVerified': true }
        );
        if (!result) {
            req.flash('error_msg', 'Company not found.');
            return res.redirect('/admin/dashboard');
        }
        req.flash('success_msg', 'Company verified successfully.');
        res.redirect('/admin/dashboard');
    } catch (err) {
        console.error('Approve error:', err);
        req.flash('error_msg', 'Failed to approve company.');
        res.redirect('/admin/dashboard');
    }
});

router.post('/reject-company/:id', isAuthenticated, authorize('admin'), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            req.flash('error_msg', 'Invalid company ID.');
            return res.redirect('/admin/dashboard');
        }
        const result = await User.findOneAndDelete({ _id: req.params.id, role: 'company' });
        if (!result) {
            req.flash('error_msg', 'Company not found or already removed.');
            return res.redirect('/admin/dashboard');
        }

        req.flash('success_msg', 'Company registration rejected.');
        res.redirect('/admin/dashboard');
    } catch (err) {
        console.error('Reject error:', err);
        req.flash('error_msg', 'Failed to reject company.');
        res.redirect('/admin/dashboard');
    }
});

module.exports = router;