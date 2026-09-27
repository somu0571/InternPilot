const express = require('express');
const router = express.Router();

const { isAuthenticated } = require('../middleware/auth');
const { deviceLabel, passwordStamp } = require('../utils/deviceInfo');
const { formatLocalizedDateTime } = require('../utils/dateFormat');

// "Where you're signed in" (#196): every browser and device signed in to the
// account, with a way to sign any of them out. Sessions live in MongoDB
// (#179), so the page reads them straight from the session store.

const HOUR_MS = 60 * 60 * 1000;

function lastActiveLabel(value, now) {
    if (!value) return 'Last active: unknown';
    const ms = now - new Date(value).getTime();
    // The store renews a session's timestamp at most once an hour.
    if (ms < HOUR_MS) return 'Active in the last hour';
    const hours = Math.floor(ms / HOUR_MS);
    if (hours < 24) return `Last active ${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return `Last active ${days} day${days === 1 ? '' : 's'} ago`;
}

/** The account's live sessions. Ones from before a password change are signed out here too. */
async function liveSessions(req) {
    const store = req.sessionStore;
    const current = passwordStamp(req.user);
    const live = [];
    for (const item of await store.listForUser(req.user._id)) {
        if (item.pwdStamp && current && item.pwdStamp !== current) {
            await store.revoke(req.user._id, item.sid);
            continue;
        }
        live.push(item);
    }
    return live;
}

router.get('/account/sessions', isAuthenticated, async (req, res, next) => {
    try {
        const now = Date.now();
        const sessions = (await liveSessions(req))
            .map(item => {
                const current = item.sid === req.sessionID;
                // On the first page after signing in, this session's device is
                // noted in this request and only reaches the store afterwards.
                const device = (current && req.session.device) || item.device;
                const signedIn = (device && device.signedInAt) || item.createdAt;
                return {
                    handle: item.handle,
                    current,
                    label: deviceLabel(device),
                    deviceType: (device && device.deviceType) || 'unknown',
                    ip: (device && device.ip) || 'unknown',
                    signedInLabel: signedIn ? formatLocalizedDateTime(signedIn) : 'Earlier',
                    activeLabel: current ? 'Active now' : lastActiveLabel(item.lastActiveAt, now),
                    lastActive: item.lastActiveAt ? new Date(item.lastActiveAt).getTime() : 0
                };
            })
            .sort((a, b) => (Number(b.current) - Number(a.current)) || (b.lastActive - a.lastActive));

        res.render('account/sessions', { sessions, otherCount: sessions.filter(s => !s.current).length });
    } catch (err) {
        next(err);
    }
});

router.post('/account/sessions/sign-out-others', isAuthenticated, async (req, res, next) => {
    try {
        const count = await req.sessionStore.revokeOthers(req.user._id, req.sessionID);
        req.flash('success_msg', count
            ? `Signed out ${count} other device${count === 1 ? '' : 's'}. They'll need to sign in again.`
            : 'No other devices were signed in.');
        return res.redirect('/account/sessions');
    } catch (err) {
        return next(err);
    }
});

router.post('/account/sessions/:handle/sign-out', isAuthenticated, async (req, res, next) => {
    try {
        // Looked up among this account's own sessions only.
        const sessions = await req.sessionStore.listForUser(req.user._id);
        const target = sessions.find(item => item.handle === String(req.params.handle));
        if (!target) {
            req.flash('error_msg', 'That device was not found. It may already be signed out.');
        } else if (target.sid === req.sessionID) {
            req.flash('error_msg', 'That is this device. Use Log Out to sign out here.');
        } else {
            await req.sessionStore.revoke(req.user._id, target.sid);
            req.flash('success_msg', `Signed out ${deviceLabel(target.device)}. It will need to sign in again.`);
        }
        return res.redirect('/account/sessions');
    } catch (err) {
        return next(err);
    }
});

module.exports = router;
module.exports.lastActiveLabel = lastActiveLabel;
