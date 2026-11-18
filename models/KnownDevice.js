const mongoose = require('mongoose');




const knownDeviceSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    fingerprint: { type: String, required: true },
    label: { type: String, default: '' },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now }
});

knownDeviceSchema.index({ user: 1, fingerprint: 1 }, { unique: true });

module.exports = mongoose.model('KnownDevice', knownDeviceSchema);
