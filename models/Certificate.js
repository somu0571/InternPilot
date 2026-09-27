const mongoose = require('mongoose');

const certificateSchema = new mongoose.Schema({
    certificateId: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        uppercase: true,
        index: true
    },
    application: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Application',
        required: true,
        index: true
    },
    candidate: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    company: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    issuedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    internship: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Internship',
        required: true
    },
    candidateName: {
        type: String,
        required: true,
        trim: true
    },
    candidateEmail: {
        type: String,
        trim: true,
        lowercase: true,
        default: ''
    },
    companyName: {
        type: String,
        required: true,
        trim: true
    },
    internshipTitle: {
        type: String,
        required: true,
        trim: true
    },
    startDate: {
        type: Date
    },
    completionDate: {
        type: Date,
        required: true,
        default: Date.now
    },
    duration: {
        type: String,
        required: true,
        trim: true,
        default: '3 Months'
    },
    skills: [{
        type: String,
        trim: true
    }],
    performanceRating: {
        type: String,
        enum: ['Outstanding', 'Exceeds Expectations', 'Very Good', 'Good'],
        default: 'Outstanding'
    },
    letterOfRecommendation: {
        type: String,
        trim: true,
        default: ''
    },
    signatoryName: {
        type: String,
        trim: true,
        default: ''
    },
    signatoryTitle: {
        type: String,
        trim: true,
        default: ''
    },
    status: {
        type: String,
        enum: ['Issued', 'Revoked'],
        default: 'Issued',
        index: true
    },
    qrCodeDataUrl: {
        type: String,
        default: ''
    },
    verificationUrl: {
        type: String,
        default: ''
    },
    issuedAt: {
        type: Date,
        default: Date.now,
        index: true
    }
}, { timestamps: true });

certificateSchema.index({ candidate: 1, issuedAt: -1 });
certificateSchema.index({ company: 1, issuedAt: -1 });

module.exports = mongoose.model('Certificate', certificateSchema);
