const KnownDevice = require('../models/KnownDevice');
const Notification = require('../models/Notification');
const { deviceLabel, deviceFingerprint } = require('./deviceInfo');

const NEW_SIGN_IN_TYPE = 'security_new_sign_in';

const FRESH_SIGN_IN_MS = 15 * 60 * 1000;


const typePath = Notification.schema.path('type');
if (typePath && Array.isArray(typePath.enumValues) && !typePath.enumValues.includes(NEW_SIGN_IN_TYPE)) {
    typePath.enum(NEW_SIGN_IN_TYPE);
}


async function recordSignIn({ user, device, sid, store, now = new Date(), models = { KnownDevice, Notification } }) {
    const fingerprint = deviceFingerprint(device);
    const label = deviceLabel(device);

    let before;
    try {
        
        before = await models.KnownDevice.findOneAndUpdate(
            { user: user._id, fingerprint },
            { $set: { lastSeenAt: now, label }, $setOnInsert: { firstSeenAt: now } },
            { upsert: true, new: false }
        );
    } catch (err) {
        if (err && err.code === 11000) return { isNew: false, notified: false }; 
        throw err;
    }
    if (before) return { isNew: false, notified: false };

    if (user.role !== 'candidate') return { isNew: true, notified: false };
    const others = await models.KnownDevice.countDocuments({ user: user._id, fingerprint: { $ne: fingerprint } });
    if (!others) return { isNew: true, notified: false };

    const createdAt = store && typeof store.createdAt === 'function' ? await store.createdAt(sid) : null;
    if (!createdAt || now - createdAt > FRESH_SIGN_IN_MS) return { isNew: true, notified: false };

    await models.Notification.create({
        recipient: user._id,
        type: NEW_SIGN_IN_TYPE,
        title: 'New sign-in to your account',
        message: `Your account was just signed in on ${label} (network ${device.ip}). If this wasn't you, sign that device out and reset your password.`,
        link: '/account/sessions'
    });
    return { isNew: true, notified: true };
}

module.exports = { NEW_SIGN_IN_TYPE, FRESH_SIGN_IN_MS, recordSignIn };
