
const nodemailer = require('nodemailer');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const User = require('../models/User');
const Application = require('../models/Application');
const { COMPANY_ROLES, hasCompanyPermission } = require('../middleware/companyAccess');

const MAX_MESSAGE_LENGTH = Message.MAX_LENGTH;
const PREVIEW_LENGTH = 140;


const READ_ONLY_STATUSES = ['withdrawn', 'rejected'];


const SEND_LIMIT = { limit: 10, windowMs: 60 * 1000 };

const EMAIL_COOLDOWN_MS = 15 * 60 * 1000;



const typePath = Notification.schema.path('type');
if (typePath && Array.isArray(typePath.enumValues) && !typePath.enumValues.includes('new_message')) {
    typePath.enum('new_message');
}

const idOf = value => String((value && value._id) || value || '');


function isReadOnlyStatus(status) {
    return READ_ONLY_STATUSES.includes(String(status || '').toLowerCase());
}


function resolveCompanyId(user) {
    if (!user) return null;
    if (user.companyId) return idOf(user.companyId);
    return user.role === 'company' ? idOf(user._id) : null;
}


function isCompanyMessenger(user) {
    return Boolean(user && COMPANY_ROLES.includes(user.role) &&
        hasCompanyPermission(user, 'applications:view') && resolveCompanyId(user));
}


function sideFor(user, conversation) {
    if (!user || !conversation) return null;
    if (user.role === 'candidate') {
        return idOf(conversation.candidate) === idOf(user._id) ? 'candidate' : null;
    }
    if (isCompanyMessenger(user) && resolveCompanyId(user) === idOf(conversation.company)) {
        return 'company';
    }
    return null;
}


function internshipCompanyId(internship) {
    if (!internship) return null;
    if (internship.companyId) return idOf(internship.companyId);
    return internship.postedBy ? idOf(internship.postedBy) : null;
}


function sideForApplication(user, application, internship) {
    if (!user || !application || !internship) return null;
    if (user.role === 'candidate') {
        return idOf(application.candidate) === idOf(user._id) ? 'candidate' : null;
    }
    const owner = internshipCompanyId(internship);
    return isCompanyMessenger(user) && owner && owner === resolveCompanyId(user) ? 'company' : null;
}


function validateMessageBody(raw) {
    const body = typeof raw === 'string' ? raw.replace(/\r\n/g, '\n').trim() : '';
    if (!body) return { error: 'Write a message before sending.' };
    if (body.length > MAX_MESSAGE_LENGTH) {
        return { error: `Messages can be up to ${MAX_MESSAGE_LENGTH} characters.` };
    }
    return { body };
}


function previewOf(body) {
    const flat = String(body || '').replace(/\s+/g, ' ').trim();
    return flat.length > PREVIEW_LENGTH ? flat.slice(0, PREVIEW_LENGTH - 1) + '…' : flat;
}


function createRateLimiter({ limit, windowMs, now = Date.now }) {
    const hits = new Map();
    return {
        hit(key) {
            const time = now();
            const recent = (hits.get(key) || []).filter(t => time - t < windowMs);
            if (recent.length >= limit) {
                hits.set(key, recent);
                return { allowed: false, retryAfterMs: windowMs - (time - recent[0]) };
            }
            recent.push(time);
            hits.set(key, recent);
            
            if (hits.size > 5000) {
                for (const [k, list] of hits) if (!list.some(t => time - t < windowMs)) hits.delete(k);
            }
            return { allowed: true, retryAfterMs: 0 };
        }
    };
}


function lastReadAt(conversation, userId) {
    const entry = (conversation.reads || []).find(r => idOf(r.user) === idOf(userId));
    return entry ? new Date(entry.at) : null;
}


function hasUnread(conversation, userId) {
    if (!conversation.lastMessageAt) return false;
    if (idOf(conversation.lastMessageBy) === idOf(userId)) return false;
    const read = lastReadAt(conversation, userId);
    return !read || new Date(conversation.lastMessageAt) > read;
}

const sendLimiter = createRateLimiter(SEND_LIMIT);
const emailSentAt = new Map();


function inboxQuery(user) {
    if (!user) return null;
    if (user.role === 'candidate') return { candidate: user._id };
    if (isCompanyMessenger(user)) return { company: resolveCompanyId(user) };
    return null;
}


async function unreadCounts(conversations, userId) {
    const withUnread = conversations.filter(c => hasUnread(c, userId)).slice(0, 100);
    if (!withUnread.length) return new Map();

    const rows = await Message.aggregate([
        {
            $match: {
                $or: withUnread.map(c => {
                    const read = lastReadAt(c, userId);
                    return {
                        conversation: c._id,
                        sender: { $ne: userId },
                        ...(read ? { createdAt: { $gt: read } } : {})
                    };
                })
            }
        },
        { $group: { _id: '$conversation', count: { $sum: 1 } } }
    ]);
    return new Map(rows.map(row => [idOf(row._id), row.count]));
}


async function countUnreadMessages(user) {
    const query = inboxQuery(user);
    if (!query) return 0;
    const conversations = await Conversation.find({ ...query, lastMessageAt: { $ne: null }, lastMessageBy: { $ne: user._id } })
        .select('reads lastMessageAt lastMessageBy')
        .lean();
    const counts = await unreadCounts(conversations, user._id);
    let total = 0;
    counts.forEach(n => { total += n; });
    return total;
}


async function getInbox(user) {
    const query = inboxQuery(user);
    if (!query) return [];
    const conversations = await Conversation.find(query)
        .sort({ lastMessageAt: -1, updatedAt: -1 })
        .limit(200)
        .populate('internship', 'title companyName')
        .populate('candidate', 'name avatar')
        .populate('company', 'name companyDetails.companyName')
        .populate('application', 'status')
        .lean();

    const counts = await unreadCounts(conversations, user._id);
    return conversations.map(c => ({ ...c, unread: counts.get(idOf(c._id)) || 0 }));
}


function startableApplications(applications, conversations) {
    const started = new Set((conversations || []).map(c => idOf(c.application)));
    return (applications || []).filter(a =>
        a && a.internship && !isReadOnlyStatus(a.status) && !started.has(idOf(a._id)));
}


async function getStartableApplications(user, conversations) {
    if (!user || user.role !== 'candidate') return [];
    const applications = await Application.find({ candidate: user._id })
        .sort({ appliedAt: -1 })
        .limit(50)
        .populate('internship', 'title companyName')
        .select('status internship appliedAt')
        .lean();
    return startableApplications(applications, conversations);
}


async function getOrCreateConversation(application, internship, user) {
    const existing = await Conversation.findOne({ application: application._id });
    if (existing) return existing;
    try {
        return await Conversation.create({
            application: application._id,
            internship: internship._id,
            candidate: idOf(application.candidate),
            company: internshipCompanyId(internship),
            startedBy: user._id
        });
    } catch (err) {
        if (err && err.code === 11000) return Conversation.findOne({ application: application._id });
        throw err;
    }
}


async function markRead(conversationId, userId) {
    const now = new Date();
    const updated = await Conversation.updateOne(
        { _id: conversationId, 'reads.user': userId },
        { $set: { 'reads.$.at': now } },
        { timestamps: false }
    );
    if (!updated.matchedCount) {
        await Conversation.updateOne(
            { _id: conversationId, 'reads.user': { $ne: userId } },
            { $push: { reads: { user: userId, at: now } } },
            { timestamps: false }
        );
    }
}

let transporter = null;
function mailer() {
    if (transporter) return transporter;
    const auth = {
        user: process.env.SMTP_USER || process.env.EMAIL_USER,
        pass: process.env.SMTP_PASS || process.env.EMAIL_PASS
    };
    if (!auth.user || !auth.pass) return null;
    
    transporter = process.env.SMTP_HOST
        ? nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT, 10) || 587,
            secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
            auth
        })
        : nodemailer.createTransport({ service: process.env.EMAIL_SERVICE || 'gmail', auth });
    return transporter;
}


async function emailRecipient(conversationId, recipient, fromName, internshipTitle, preview) {
    try {
        if (!recipient || !recipient.email) return;
        const key = `${conversationId}:${idOf(recipient._id)}`;
        const last = emailSentAt.get(key) || 0;
        if (Date.now() - last < EMAIL_COOLDOWN_MS) return;
        const transport = mailer();
        if (!transport) return;
        emailSentAt.set(key, Date.now());

        const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 8080}`;
        await transport.sendMail({
            from: `"InternPilot" <${process.env.SMTP_USER || process.env.EMAIL_USER}>`,
            to: recipient.email,
            subject: `New message from ${fromName} about ${internshipTitle}`,
            text: `${fromName} sent you a message about "${internshipTitle}":\n\n${preview}\n\nReply on InternPilot: ${base}/messages/${conversationId}`
        });
    } catch (err) {
        console.error('Could not send message email:', err.message);
    }
}


async function postMessage(conversation, sender, side, body) {
    const message = await Message.create({ conversation: conversation._id, sender: sender._id, senderSide: side, body });
    const preview = previewOf(body);

    await Conversation.updateOne(
        { _id: conversation._id },
        { $set: { lastMessageAt: message.createdAt, lastMessagePreview: preview, lastMessageBy: sender._id } }
    );
    await markRead(conversation._id, sender._id);

    const internshipTitle = (conversation.internship && conversation.internship.title) || 'an internship';
    const link = `/messages/${conversation._id}`;

    try {
        if (side === 'company') {
            const companyName = conversation.company?.companyDetails?.companyName || conversation.company?.name || 'A recruiter';
            await Notification.create({
                recipient: idOf(conversation.candidate),
                type: 'new_message',
                title: `New message from ${companyName}`,
                message: preview,
                link
            });
            const candidate = await User.findById(idOf(conversation.candidate)).select('email name').lean();
            emailRecipient(idOf(conversation._id), candidate, companyName, internshipTitle, preview);
        } else {
            const candidateName = conversation.candidate?.name || sender.name || 'A candidate';
            await Notification.create({
                companyId: idOf(conversation.company),
                type: 'new_message',
                title: `New message from ${candidateName}`,
                message: preview,
                link
            });
            const company = await User.findById(idOf(conversation.company)).select('email name').lean();
            emailRecipient(idOf(conversation._id), company, candidateName, internshipTitle, preview);
        }
    } catch (err) {
        
        console.error('Could not create message notification:', err.message);
    }

    return message;
}

module.exports = {
    MAX_MESSAGE_LENGTH,
    READ_ONLY_STATUSES,
    SEND_LIMIT,
    EMAIL_COOLDOWN_MS,
    isReadOnlyStatus,
    resolveCompanyId,
    isCompanyMessenger,
    sideFor,
    sideForApplication,
    internshipCompanyId,
    validateMessageBody,
    previewOf,
    createRateLimiter,
    lastReadAt,
    hasUnread,
    sendLimiter,
    inboxQuery,
    unreadCounts,
    countUnreadMessages,
    getInbox,
    startableApplications,
    getStartableApplications,
    getOrCreateConversation,
    markRead,
    postMessage
};
