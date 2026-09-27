const mongoose = require('mongoose');

// Browsers and devices an account has signed in from (#196), so a sign-in
// from a new one can be flagged. Only the browser, OS and device type are
// kept (e.g. "Chrome on Android"), never the full user agent or IP address.
const knownDeviceSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    fingerprint: { type: String, required: true },
    label: { type: String, default: '' },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now }
});

knownDeviceSchema.index({ user: 1, fingerprint: 1 }, { unique: true });

module.exports = mongoose.model('KnownDevice', knownDeviceSchema);
