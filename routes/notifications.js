const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Notification = require('../models/Notification');
const { isAuthenticated, authorize, requireCompanyRole } = require('../middleware/auth');

router.get('/notifications', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const notifications = await Notification.find({ recipient: req.user._id })
            .sort({ createdAt: -1 })
            .limit(100);

        return res.render('candidate/notifications', { notifications });
    } catch (error) {
        console.error('Error loading notifications:', error);
        return res.status(500).send('Database Error');
    }
});

router.post('/notifications/read-all', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        await Notification.updateMany(
            { recipient: req.user._id, isRead: false },
            { $set: { isRead: true } }
        );
        return res.redirect('/notifications');
    } catch (error) {
        console.error('Error marking notifications as read:', error);
        return res.status(500).send('Database Error');
    }
});

router.post('/notifications/:id/read', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.redirect('/notifications');
        }

        await Notification.findOneAndUpdate(
            { _id: req.params.id, recipient: req.user._id },
            { $set: { isRead: true } }
        );
        return res.redirect('/notifications');
    } catch (error) {
        console.error('Error marking notification as read:', error);
        return res.status(500).send('Database Error');
    }
});



router.get('/company/notifications', isAuthenticated, requireCompanyRole(['company', 'recruiter']), async (req, res) => {
    try {
        const targetCompanyId = req.user.role === 'company' ? req.user._id : req.user.companyId;
        const notifications = await Notification.find({ companyId: targetCompanyId })
            .populate('internship')
            .sort({ createdAt: -1 })
            .limit(100);

        return res.render('company/company-notifications', { notifications, currentUser: req.user });
    } catch (error) {
        console.error('Error loading company notifications:', error);
        return res.status(500).send('Database Error');
    }
});

router.post('/company/notifications/read-all', isAuthenticated, requireCompanyRole(['company', 'recruiter']), async (req, res) => {
    try {
        const targetCompanyId = req.user.role === 'company' ? req.user._id : req.user.companyId;
        await Notification.updateMany(
            { companyId: targetCompanyId, isRead: false },
            { $set: { isRead: true } }
        );
        return res.redirect('/company/notifications');
    } catch (error) {
        console.error('Error marking company notifications as read:', error);
        return res.status(500).send('Database Error');
    }
});

router.post('/company/notifications/:id/read', isAuthenticated, requireCompanyRole(['company', 'recruiter']), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.redirect('/company/notifications');
        }

        const targetCompanyId = req.user.role === 'company' ? req.user._id : req.user.companyId;
        await Notification.findOneAndUpdate(
            { _id: req.params.id, companyId: targetCompanyId },
            { $set: { isRead: true } }
        );
        return res.redirect('/company/notifications');
    } catch (error) {
        console.error('Error marking company notification as read:', error);
        return res.status(500).send('Database Error');
    }
});

module.exports = router;
