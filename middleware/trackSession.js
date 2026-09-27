const { describeDevice, passwordStamp } = require('../utils/deviceInfo');

/**
 * Keeps signed-in sessions honest (#196). Runs on every request after
 * passport has loaded the user:
 *
 * - On the first request of a signed-in session it notes the device (browser,
 *   OS, device type, masked IP) and a fingerprint of the password, and records
 *   the device so a sign-in from a new one can be flagged. This covers every
 *   way of signing in, email and Google alike, without touching the login code.
 * - If the password has changed since the session signed in (for example a
 *   password reset from another device), the session is signed out.
 */
function createTrackSession({ recordSignIn = require('../utils/signInDevices').recordSignIn, now = () => Date.now() } = {}) {
    return function trackSession(req, res, next) {
        if (!req.user || !req.session) return next();
        const stamp = passwordStamp(req.user);

        if (req.session.pwdStamp && stamp && req.session.pwdStamp !== stamp) {
            return req.logout(err => {
                if (err) return next(err);
                if (req.flash) req.flash('error_msg', 'Your password was changed, so this device was signed out. Please sign in again.');
                return res.redirect('/auth/login');
            });
        }

        if (!req.session.device) {
            req.session.device = describeDevice(req.get('user-agent'), req.ip, now());
            if (stamp) req.session.pwdStamp = stamp;
            // Never hold up the page for this, and never fail it.
            Promise.resolve()
                .then(() => recordSignIn({ user: req.user, device: req.session.device, sid: req.sessionID, store: req.sessionStore }))
                .catch(err => console.error('Could not record the sign-in device:', err.message));
        } else if (!req.session.pwdStamp && stamp) {
            // Sessions that signed in before this check existed.
            req.session.pwdStamp = stamp;
        }
        return next();
    };
}

module.exports = createTrackSession();
module.exports.createTrackSession = createTrackSession;
