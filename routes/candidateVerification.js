const express = require('express');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const CandidateVerification = require('../models/CandidateVerification');
const { isAuthenticated, authorize } = require('../middleware/auth');
const { documentUpload, uploadBufferToCloudinary } = require('../middleware/upload');
const {
    CandidateVerificationError,
    maskIdentifier,
    statusLabel,
    submitCandidateVerification,
    verificationStatus
} = require('../utils/candidateVerification');

const router = express.Router();

function candidateId(req) {
    return req.user?._id || req.user?.id;
}

function handleVerificationDocumentsUpload(req, res, next) {
    documentUpload.array('documents', 4)(req, res, error => {
        if (!error) return next();
        const message = error.code === 'LIMIT_FILE_SIZE'
            ? 'Each verification document must be 5MB or smaller.'
            : (error.message || 'Verification document upload failed.');
        if (req.flash) req.flash('error_msg', message);
        return res.redirect('/candidate/verification');
    });
}





async function storeVerificationDocument(file, {
    upload = uploadBufferToCloudinary,
    environment = process.env.NODE_ENV,
    uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'candidate-verification'),
    publicUrlBase = '/uploads/candidate-verification'
} = {}) {
    try {
        return await upload(file, 'internpilot/candidate_verification');
    } catch (cloudError) {
        if (environment === 'production') throw cloudError;

        const safeName = String(file.originalname || 'verification-document')
            .replace(/[^a-zA-Z0-9_.-]/g, '_');
        const fileName = `${Date.now()}_${randomUUID()}_${safeName}`;
        await fs.promises.mkdir(uploadDir, { recursive: true });
        await fs.promises.writeFile(path.join(uploadDir, fileName), file.buffer);

        console.warn('Cloudinary upload failed; saved candidate verification document locally for development:', cloudError.message || cloudError);
        return {
            public_id: `local/candidate_verification/${fileName}`,
            secure_url: `${publicUrlBase}/${fileName}`
        };
    }
}

router.get('/candidate/verification', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const verification = await CandidateVerification.findOne({ candidate: candidateId(req) })
            .populate('reviewedBy', 'name email')
            .populate('history.changedBy', 'name email');
        return res.render('candidate/verification', {
            verification,
            verificationStatus: verificationStatus(verification),
            statusLabel
        });
    } catch (error) {
        console.error('Error loading candidate verification:', error);
        if (req.flash) req.flash('error_msg', 'Unable to load verification details. Please try again.');
        return res.redirect('/candidate/profile');
    }
});

router.post('/candidate/verification/documents', isAuthenticated, authorize('candidate'), handleVerificationDocumentsUpload, async (req, res) => {
    try {
        const files = Array.isArray(req.files) ? req.files : [];
        if (!files.length) {
            throw new CandidateVerificationError('Upload at least one verification document.', 'VERIFICATION_DOCUMENT_REQUIRED');
        }

        
        
        
        const maskedIdentifier = maskIdentifier(req.body?.identifierLastFour);
        const documentType = ['identity', 'education', 'income', 'other'].includes(req.body?.documentType)
            ? req.body.documentType
            : 'identity';
        const documents = await Promise.all(files.map(async file => {
            const uploaded = await storeVerificationDocument(file);
            return {
                documentType,
                fileName: String(file.originalname || 'verification-document').slice(0, 180),
                storageKey: String(uploaded.public_id || ''),
                fileUrl: String(uploaded.secure_url || '')
            };
        }));

        if (documents.some(document => !document.storageKey)) {
            throw new CandidateVerificationError('Unable to store one or more verification documents.', 'VERIFICATION_DOCUMENT_UPLOAD_FAILED', 502);
        }

        let verification = await CandidateVerification.findOne({ candidate: candidateId(req) });
        if (!verification) verification = new CandidateVerification({ candidate: candidateId(req) });
        submitCandidateVerification(verification, {
            candidateId: candidateId(req),
            documents,
            maskedIdentifier
        });
        await verification.save();

        if (req.flash) req.flash('success_msg', 'Verification documents submitted. An admin will review them before you can apply or accept an offer.');
        return res.redirect('/candidate/verification');
    } catch (error) {
        console.error('Error submitting candidate verification:', error);
        if (req.flash) req.flash('error_msg', error instanceof CandidateVerificationError
            ? error.message
            : 'Unable to submit verification documents. Please try again.');
        return res.redirect('/candidate/verification');
    }
});

router.storeVerificationDocument = storeVerificationDocument;
module.exports = router;
