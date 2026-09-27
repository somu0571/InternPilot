const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true, maxlength: 140 },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    audience: { type: String, enum: ['all', 'candidates', 'companies'], default: 'all', index: true },
    tone: { type: String, enum: ['info', 'warning', 'success'], default: 'info' },
    startsAt: { type: Date, required: true, default: Date.now, index: true },
    endsAt: { type: Date, required: true, index: true },
    sendInApp: { type: Boolean, default: false },
    inAppSentAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

announcementSchema.pre('validate', function () {
    if (this.startsAt && this.endsAt && this.endsAt <= this.startsAt) {
        this.invalidate('endsAt', 'End time must be after start time.');
    }
});

announcementSchema.index({ startsAt: 1, endsAt: 1, audience: 1 });

module.exports = mongoose.model('Announcement', announcementSchema);
