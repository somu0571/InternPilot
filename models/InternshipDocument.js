const mongoose = require('mongoose');

const internshipDocumentSchema = new mongoose.Schema({
    application: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Application',
        required: true,
        index: true
    },
    internship: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Internship',
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
    type: {
        type: String,
        enum: ['internship-certificate', 'recommendation-letter'],
        required: true
    },
    fileName: { type: String, required: true },
    contentType: { type: String, default: 'application/pdf', required: true },
    fileData: { type: Buffer, required: true },
    issuedAt: { type: Date, default: Date.now, required: true }
}, { timestamps: true });

internshipDocumentSchema.index({ application: 1, type: 1 }, { unique: true });
internshipDocumentSchema.index({ candidate: 1, application: 1 });

module.exports = mongoose.model('InternshipDocument', internshipDocumentSchema);