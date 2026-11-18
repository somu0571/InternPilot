const { describeDevice, passwordStamp } = require('../utils/deviceInfo');


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
            
            Promise.resolve()
                .then(() => recordSignIn({ user: req.user, device: req.session.device, sid: req.sessionID, store: req.sessionStore }))
                .catch(err => console.error('Could not record the sign-in device:', err.message));
        } else if (!req.session.pwdStamp && stamp) {
            
            req.session.pwdStamp = stamp;
        }
        return next();
    };
}

module.exports = createTrackSession();
module.exports.createTrackSession = createTrackSession;
