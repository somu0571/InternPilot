const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const QRCode = require('qrcode');
const Certificate = require('../models/Certificate');
const Application = require('../models/Application');
const Internship = require('../models/Internship');
const User = require('../models/User');
const { isAuthenticated } = require('../middleware/auth');
const {
    companyName,
    belongsToCompany,
    requireCompanyPermission
} = require('../middleware/companyAccess');
const { generateCertificateId, isValidCertificateId } = require('../utils/certificateId');
const { notifyCertificateIssued } = require('../utils/notifications');

/**
 * Helper to ensure a QR code data URL is available for a verification URL.
 */
async function generateQrCode(url) {
    try {
        return await QRCode.toDataURL(url, {
            errorCorrectionLevel: 'M',
            margin: 1,
            width: 220,
            color: {
                dark: '#1e1b4b', // Deep indigo
                light: '#ffffff'
            }
        });
    } catch (err) {
        console.error('Failed to generate QR code data URL:', err);
        return '';
    }
}

/**
 * Parse skills input from form (string with commas or array).
 */
function parseSkillsInput(input) {
    if (Array.isArray(input)) {
        return input.map(s => String(s).trim()).filter(Boolean);
    }
    if (typeof input === 'string') {
        return input
            .split(/[,;\n]/)
            .map(s => s.trim())
            .filter(Boolean);
    }
    return [];
}

// ---------------------------------------------------------
// Recruiter / Company Routes: Certificate Issuance
// ---------------------------------------------------------

/**
 * GET /company/applications/:id/certificate/issue
 * Renders the certificate issuance form.
 */
router.get(
    '/company/applications/:id/certificate/issue',
    isAuthenticated,
    requireCompanyPermission('applications:review'),
    async (req, res) => {
        try {
            if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
                if (req.flash) req.flash('error_msg', 'Application not found.');
                return res.redirect('/company/dashboard');
            }

            const application = await Application.findById(req.params.id)
                .populate('candidate')
                .populate('internship');

            if (!application || !application.internship || !application.candidate || !belongsToCompany(application.internship, req.company)) {
                if (req.flash) req.flash('error_msg', 'Application or candidate not found.');
                return res.redirect('/company/dashboard');
            }

            // Check if certificate already issued
            const existingCertificate = await Certificate.findOne({
                application: application._id,
                status: 'Issued'
            });

            if (existingCertificate) {
                if (req.flash) req.flash('info_msg', 'An official certificate has already been issued for this intern.');
                return res.redirect(`/certificates/${existingCertificate.certificateId}/view`);
            }

            // Extract candidate skills for prefill
            let prefilledSkills = [];
            if (application.candidate?.skills && Array.isArray(application.candidate.skills)) {
                prefilledSkills = application.candidate.skills.map(s => (typeof s === 'string' ? s : s.name)).filter(Boolean);
            } else if (application.applicationKit?.skills && Array.isArray(application.applicationKit.skills)) {
                prefilledSkills = application.applicationKit.skills.map(s => s.name).filter(Boolean);
            }

            // Fallback to internship skills if candidate has none listed
            if (!prefilledSkills.length && application.internship?.skillsRequired) {
                prefilledSkills = Array.isArray(application.internship.skillsRequired)
                    ? application.internship.skillsRequired
                    : [application.internship.skillsRequired];
            }

            res.render('company/issue-certificate', {
                user: req.user,
                application,
                candidate: application.candidate,
                internship: application.internship,
                company: req.company,
                cName: companyName(req.company),
                prefilledSkills: [...new Set(prefilledSkills)],
                permissions: req.companyPermissions
            });
        } catch (error) {
            console.error('Error rendering certificate issuance form:', error);
            if (req.flash) req.flash('error_msg', 'Failed to load certificate issuance form.');
            res.redirect('/company/dashboard');
        }
    }
);

/**
 * POST /company/applications/:id/certificate/issue
 * Processes issuance of Certificate & LOR.
 */
router.post(
    '/company/applications/:id/certificate/issue',
    isAuthenticated,
    requireCompanyPermission('applications:review'),
    async (req, res) => {
        try {
            if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
                if (req.flash) req.flash('error_msg', 'Application not found.');
                return res.redirect('/company/dashboard');
            }

            const application = await Application.findById(req.params.id)
                .populate('candidate')
                .populate('internship');

            if (!application || !application.internship || !application.candidate || !belongsToCompany(application.internship, req.company)) {
                if (req.flash) req.flash('error_msg', 'Application or candidate not found.');
                return res.redirect('/company/dashboard');
            }

            // Check if certificate already exists
            const existingCertificate = await Certificate.findOne({
                application: application._id,
                status: 'Issued'
            });

            if (existingCertificate) {
                if (req.flash) req.flash('info_msg', 'An official certificate has already been issued for this intern.');
                return res.redirect(`/certificates/${existingCertificate.certificateId}/view`);
            }

            const rawCompletionDate = req.body.completionDate ? new Date(req.body.completionDate) : new Date();
            const completionDate = isNaN(rawCompletionDate.getTime()) ? new Date() : rawCompletionDate;

            let startDate;
            if (req.body.startDate) {
                const parsedStart = new Date(req.body.startDate);
                if (!isNaN(parsedStart.getTime())) startDate = parsedStart;
            }

            const duration = (req.body.duration || application.internship.duration || '3 Months').trim();
            const performanceRating = ['Outstanding', 'Exceeds Expectations', 'Very Good', 'Good'].includes(req.body.performanceRating)
                ? req.body.performanceRating
                : 'Outstanding';

            const skills = parseSkillsInput(req.body.skills);
            const letterOfRecommendation = (req.body.letterOfRecommendation || '').trim();
            const signatoryName = (req.body.signatoryName || req.user.name || '').trim();
            const signatoryTitle = (req.body.signatoryTitle || 'Authorized Representative').trim();

            // Generate unique tamper-proof certificate ID
            let certificateId;
            let collisionCount = 0;
            do {
                certificateId = generateCertificateId(completionDate.getFullYear());
                const exists = await Certificate.exists({ certificateId });
                if (!exists) break;
                collisionCount++;
            } while (collisionCount < 5);

            // Construct verification URL
            const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
            const host = req.get('host') || 'localhost:5000';
            const baseUrl = (process.env.APP_URL || `${protocol}://${host}`).replace(/\/+$/, '');
            const verificationUrl = `${baseUrl}/verify/certificate/${certificateId}`;

            // Generate QR code data URL
            const qrCodeDataUrl = await generateQrCode(verificationUrl);

            const resolvedCompanyName = companyName(req.company) || application.internship.companyName || 'Host Organisation';
            const resolvedCandidateName = application.candidate.name || 'Intern';

            const certificate = new Certificate({
                certificateId,
                application: application._id,
                candidate: application.candidate._id,
                company: req.company._id,
                issuedBy: req.user._id,
                internship: application.internship._id,
                candidateName: resolvedCandidateName,
                candidateEmail: application.candidate.email || '',
                companyName: resolvedCompanyName,
                internshipTitle: application.internship.title,
                startDate,
                completionDate,
                duration,
                skills,
                performanceRating,
                letterOfRecommendation,
                signatoryName,
                signatoryTitle,
                status: 'Issued',
                qrCodeDataUrl,
                verificationUrl,
                issuedAt: new Date()
            });

            await certificate.save();

            // Mark application status as Hired if not already Hired
            if (application.status !== 'Hired') {
                application.status = 'Hired';
                application.statusUpdatedAt = new Date();
                application.statusHistory.push({
                    status: 'Hired',
                    changedAt: new Date()
                });
                await application.save();
            }

            // Dispatch candidate in-app notification & email
            await notifyCertificateIssued(certificate);

            if (req.flash) req.flash('success_msg', 'Official Certificate of Completion & LOR issued successfully!');
            res.redirect(`/certificates/${certificate.certificateId}/view`);
        } catch (error) {
            console.error('Error issuing certificate:', error);
            if (req.flash) req.flash('error_msg', 'Failed to issue certificate. Please check your inputs and try again.');
            res.redirect(`/company/applications/${req.params.id}/candidate`);
        }
    }
);

// ---------------------------------------------------------
// Candidate Dashboard: Certificates & Credentials
// ---------------------------------------------------------

/**
 * GET /candidate/certificates
 * Lists all certificates earned by the candidate.
 */
router.get('/candidate/certificates', isAuthenticated, async (req, res) => {
    try {
        if (req.user.role !== 'candidate') {
            if (req.flash) req.flash('error_msg', 'Only candidates have a personal certificates dashboard.');
            return res.redirect('/');
        }

        const certificates = await Certificate.find({
            candidate: req.user._id,
            status: 'Issued'
        })
            .populate('internship')
            .sort({ issuedAt: -1 });

        // Calculate statistics
        const allSkills = new Set();
        certificates.forEach(c => (c.skills || []).forEach(s => allSkills.add(s)));
        const withLORCount = certificates.filter(c => Boolean(c.letterOfRecommendation)).length;

        res.render('candidate/certificates', {
            user: req.user,
            certificates,
            stats: {
                totalCertificates: certificates.length,
                totalSkills: allSkills.size,
                withLORCount
            },
            currentPath: '/candidate/certificates'
        });
    } catch (error) {
        console.error('Error fetching candidate certificates:', error);
        if (req.flash) req.flash('error_msg', 'Failed to load your certificates.');
        res.redirect('/candidate/profile');
    }
});

// ---------------------------------------------------------
// Certificate Printable & Presentation View
// ---------------------------------------------------------

/**
 * GET /certificates/:certificateId/view
 * Full-resolution certificate display with print/download styling and LOR.
 */
router.get('/certificates/:certificateId/view', async (req, res) => {
    try {
        const cleanId = (req.params.certificateId || '').trim().toUpperCase();
        const certificate = await Certificate.findOne({ certificateId: cleanId })
            .populate('candidate')
            .populate('internship')
            .populate('company');

        if (!certificate) {
            if (req.flash) req.flash('error_msg', 'Certificate not found or invalid credential ID.');
            return res.redirect('/verify/certificate');
        }

        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        const host = req.get('host') || 'localhost:5000';
        const baseUrl = (process.env.APP_URL || `${protocol}://${host}`).replace(/\/+$/, '');
        const verifyUrl = `${baseUrl}/verify/certificate/${certificate.certificateId}`;

        // Ensure QR code is present; generate if missing
        let qrCodeDataUrl = certificate.qrCodeDataUrl;
        if (!qrCodeDataUrl) {
            qrCodeDataUrl = await generateQrCode(verifyUrl);
            certificate.qrCodeDataUrl = qrCodeDataUrl;
            certificate.verificationUrl = verifyUrl;
            await certificate.save();
        }

        res.render('certificates/view', {
            user: req.user,
            certificate,
            verifyUrl,
            currentPath: `/certificates/${certificate.certificateId}/view`
        });
    } catch (error) {
        console.error('Error viewing certificate:', error);
        if (req.flash) req.flash('error_msg', 'Failed to display certificate.');
        res.redirect('/verify/certificate');
    }
});

// ---------------------------------------------------------
// Public Verification Portal
// ---------------------------------------------------------

/**
 * GET /verify/certificate
 * Public verification search page.
 */
router.get('/verify/certificate', async (req, res) => {
    try {
        const queryId = (req.query.id || req.query.certificateId || '').trim().toUpperCase();
        if (queryId) {
            return res.redirect(`/verify/certificate/${encodeURIComponent(queryId)}`);
        }

        res.render('certificates/verify', {
            user: req.user,
            certificate: null,
            searchedId: '',
            notFound: false,
            currentPath: '/verify/certificate'
        });
    } catch (error) {
        console.error('Error loading verification portal:', error);
        res.render('certificates/verify', {
            user: req.user,
            certificate: null,
            searchedId: '',
            notFound: false,
            currentPath: '/verify/certificate'
        });
    }
});

/**
 * GET /verify/certificate/:certificateId
 * Public verification result page.
 */
router.get('/verify/certificate/:certificateId', async (req, res) => {
    try {
        const cleanId = (req.params.certificateId || '').trim().toUpperCase();
        const certificate = await Certificate.findOne({ certificateId: cleanId })
            .populate('internship')
            .populate('company');

        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        const host = req.get('host') || 'localhost:5000';
        const baseUrl = (process.env.APP_URL || `${protocol}://${host}`).replace(/\/+$/, '');
        const verifyUrl = `${baseUrl}/verify/certificate/${cleanId}`;

        if (!certificate) {
            return res.render('certificates/verify', {
                user: req.user,
                certificate: null,
                searchedId: cleanId,
                notFound: true,
                currentPath: '/verify/certificate'
            });
        }

        res.render('certificates/verify', {
            user: req.user,
            certificate,
            searchedId: cleanId,
            notFound: false,
            verifyUrl,
            currentPath: '/verify/certificate'
        });
    } catch (error) {
        console.error('Error verifying certificate:', error);
        res.render('certificates/verify', {
            user: req.user,
            certificate: null,
            searchedId: req.params.certificateId,
            notFound: true,
            currentPath: '/verify/certificate'
        });
    }
});

/**
 * GET /api/certificates/:certificateId/verify
 * Programmatic JSON API endpoint for external verification.
 */
router.get('/api/certificates/:certificateId/verify', async (req, res) => {
    try {
        const cleanId = (req.params.certificateId || '').trim().toUpperCase();
        const certificate = await Certificate.findOne({ certificateId: cleanId });

        if (!certificate || certificate.status !== 'Issued') {
            return res.status(404).json({
                success: false,
                verified: false,
                message: 'Certificate not found or revoked.'
            });
        }

        res.json({
            success: true,
            verified: true,
            certificate: {
                certificateId: certificate.certificateId,
                candidateName: certificate.candidateName,
                companyName: certificate.companyName,
                internshipTitle: certificate.internshipTitle,
                completionDate: certificate.completionDate,
                duration: certificate.duration,
                performanceRating: certificate.performanceRating,
                skills: certificate.skills || [],
                hasLetterOfRecommendation: Boolean(certificate.letterOfRecommendation),
                status: certificate.status,
                issuedAt: certificate.issuedAt
            }
        });
    } catch (error) {
        console.error('Error in certificate verification API:', error);
        res.status(500).json({
            success: false,
            verified: false,
            message: 'Internal verification service error.'
        });
    }
});

module.exports = router;
