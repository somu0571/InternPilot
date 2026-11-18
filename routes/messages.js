const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Application = require('../models/Application');


require('../models/Internship');
const { isAuthenticated } = require('../middleware/auth');
const messaging = require('../utils/messaging');

const wantsJson = req => req.get('X-Requested-With') === 'fetch' || req.accepts(['html', 'json']) === 'json';



router.use(async (req, res, next) => {
    res.locals.messageUnreadCount = 0;
    if (req.user && req.method === 'GET' && !wantsJson(req)) {
        try {
            res.locals.messageUnreadCount = await messaging.countUnreadMessages(req.user);
        } catch (err) {
            console.error('Error loading unread message count:', err);
        }
    }
    next();
});


async function loadConversation(req, res, next) {
    try {
        const { id } = req.params;
        const conversation = mongoose.Types.ObjectId.isValid(id)
            ? await Conversation.findById(id)
                .populate('internship', 'title companyName')
                .populate('candidate', 'name avatar')
                .populate('company', 'name companyDetails.companyName')
                .populate('application', 'status')
            : null;

        const side = messaging.sideFor(req.user, conversation);
        if (!conversation || !side) {
            if (wantsJson(req)) return res.status(404).json({ error: 'Conversation not found.' });
            return next('route');
        }

        req.conversation = conversation;
        req.side = side;
        req.readOnly = messaging.isReadOnlyStatus(conversation.application && conversation.application.status);
        return next();
    } catch (err) {
        return next(err);
    }
}

const serialize = (message, viewer) => ({
    id: String(message._id),
    body: message.body,
    senderSide: message.senderSide,
    senderName: (message.sender && message.sender.name) || '',
    mine: String((message.sender && message.sender._id) || message.sender) === String(viewer._id),
    createdAt: message.createdAt
});

router.get('/messages', isAuthenticated, async (req, res, next) => {
    try {
        const canMessage = Boolean(messaging.inboxQuery(req.user));
        const conversations = canMessage ? await messaging.getInbox(req.user) : [];
        const startable = await messaging.getStartableApplications(req.user, conversations);
        res.render('messages/inbox', {
            conversations,
            startable,
            canMessage,
            viewerSide: req.user.role === 'candidate' ? 'candidate' : 'company'
        });
    } catch (err) {
        next(err);
    }
});


router.post('/messages/start/:applicationId', isAuthenticated, async (req, res, next) => {
    try {
        const { applicationId } = req.params;
        const application = mongoose.Types.ObjectId.isValid(applicationId)
            ? await Application.findById(applicationId).populate('internship')
            : null;

        const side = application && messaging.sideForApplication(req.user, application, application.internship);
        if (!side) return next('route');

        const conversation = await messaging.getOrCreateConversation(application, application.internship, req.user);
        res.redirect(`/messages/${conversation._id}`);
    } catch (err) {
        next(err);
    }
});

router.get('/messages/:id', isAuthenticated, loadConversation, async (req, res, next) => {
    try {
        const messages = await Message.find({ conversation: req.conversation._id })
            .sort({ createdAt: 1 })
            .limit(500)
            .populate('sender', 'name')
            .lean();
        await messaging.markRead(req.conversation._id, req.user._id);

        res.render('messages/thread', {
            conversation: req.conversation,
            messages: messages.map(m => serialize(m, req.user)),
            side: req.side,
            readOnly: req.readOnly,
            maxLength: messaging.MAX_MESSAGE_LENGTH
        });
    } catch (err) {
        next(err);
    }
});


router.get('/messages/:id/updates', isAuthenticated, loadConversation, async (req, res, next) => {
    try {
        const after = new Date(req.query.after);
        const since = Number.isNaN(after.getTime()) ? new Date(0) : after;
        const messages = await Message.find({ conversation: req.conversation._id, createdAt: { $gt: since } })
            .sort({ createdAt: 1 })
            .limit(100)
            .populate('sender', 'name')
            .lean();
        if (messages.length) await messaging.markRead(req.conversation._id, req.user._id);

        res.set('Cache-Control', 'no-store');
        res.json({ messages: messages.map(m => serialize(m, req.user)), readOnly: req.readOnly });
    } catch (err) {
        next(err);
    }
});

router.post('/messages/:id', isAuthenticated, loadConversation, async (req, res, next) => {
    const threadUrl = `/messages/${req.conversation._id}`;
    const fail = (status, error) => {
        if (wantsJson(req)) return res.status(status).json({ error });
        if (req.flash) req.flash('error_msg', error);
        return res.redirect(threadUrl);
    };

    try {
        if (req.readOnly) return fail(409, 'This application is closed, so the conversation is read-only.');

        const { body, error } = messaging.validateMessageBody(req.body.body);
        if (error) return fail(400, error);

        const limit = messaging.sendLimiter.hit(String(req.user._id));
        if (!limit.allowed) {
            res.set('Retry-After', String(Math.ceil(limit.retryAfterMs / 1000)));
            return fail(429, 'You are sending messages too quickly. Please wait a moment.');
        }

        const message = await messaging.postMessage(req.conversation, req.user, req.side, body);

        if (wantsJson(req)) {
            return res.status(201).json({ message: serialize({ ...message.toObject(), sender: req.user }, req.user) });
        }
        return res.redirect(threadUrl);
    } catch (err) {
        return next(err);
    }
});

module.exports = router;
