const express = require('express');
const path = require('path');
const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

const pdfParseModule = require('pdf-parse');
const mammoth = require('mammoth');

const User = require('../models/User');
const CandidateVerification = require('../models/CandidateVerification');
const Internship = require('../models/Internship');
const Application = require('../models/Application');
const Recommendation = require('../models/Recommendation');
const { generateRecommendationsForUser } = require('../utils/recommendationEngine');
const { isAuthenticated, authorize } = require('../middleware/auth');
const { documentUpload, uploadBufferToCloudinary } = require('../middleware/upload');
const { calculateSkillScore } = require('../utils/skillMatch');
const { detectProfileConflicts } = require('../utils/conflictDetector');
const { recordResumeParse } = require('../utils/resumeParse');
const { formatRelativeTime, formatLocalizedDateTime } = require('../utils/dateFormat');
const { buildSkillProfiles, parseSkillProfiles, skillNames } = require('../utils/skillProfiles');
const { sanitizeHttpUrl } = require('../utils/safeUrl');
const { filterAndSortApplications } = require('../utils/applicationSearch');
const { getIssuedDocumentsByApplication } = require('../utils/internshipDocuments');
const MockInterviewSession = require('../models/MockInterviewSession');
const { calculateProfileCompletion } = require('../utils/profileCompletion');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'application/pdf',
            'application/x-pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];
        const ext = path.extname(file.originalname || '').toLowerCase();
        const allowedExts = ['.pdf', '.doc', '.docx'];
        if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
            cb(null, true);
        } else {
            const err = new Error('Invalid file type. Only PDF (.pdf) and Word (.docx, .doc) files are allowed.');
            err.code = 'INVALID_FILE_TYPE';
            cb(err);
        }
    }
});

async function extractPdfText(buffer) {
    if (pdfParseModule.PDFParse) {
        const parser = new pdfParseModule.PDFParse({ data: buffer });
        const result = await parser.getText();
        return result.text || '';
    }

    const parseFn = typeof pdfParseModule === 'function'
        ? pdfParseModule
        : (pdfParseModule.default || pdfParseModule);

    const result = await parseFn(buffer);
    return result.text || '';
}

async function extractDocxText(buffer) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
}

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resumeVersionPayload({ label, fileUrl, fileName, text, createdAt = new Date() }) {
    const normalizedLabel = typeof label === 'string' ? label.trim().slice(0, 100) : '';
    const normalizedFileName = typeof fileName === 'string' ? fileName.trim().slice(0, 180) : '';
    return {
        label: normalizedLabel || normalizedFileName || 'Resume version',
        fileUrl,
        fileName: normalizedFileName,
        text: text || '',
        isDefault: true,
        createdAt
    };
}

async function storeResumeVersion(userId, versionPayload) {
    const profile = await User.findById(userId).select('resumeVersions');
    if (!profile) throw new Error('Candidate profile not found.');
    profile.resumeVersions.forEach(version => { version.isDefault = false; });
    profile.resumeVersions.push(versionPayload);
    await profile.save();
}

async function analyzeResumeQuality(text, customClient = null) {
    if (!text || !text.trim()) {
        console.warn('Resume text is empty; skipping AI quality feedback generation.');
        return {
            quantifiableAchievements: { status: 'needs_improvement', feedback: 'Resume text could not be extracted.' },
            technicalSkills: { status: 'needs_improvement', feedback: 'Resume text could not be extracted.' },
            projects: { status: 'needs_improvement', feedback: 'Resume text could not be extracted.' },
            overallFeedback: 'Resume uploaded successfully, but text could not be read for AI feedback.'
        };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey && !customClient) {
        console.warn('GEMINI_API_KEY is not configured in environment variables.');
        return {
            quantifiableAchievements: { status: 'needs_improvement', feedback: 'Resume quality analysis was unavailable.' },
            technicalSkills: { status: 'needs_improvement', feedback: 'Resume quality analysis was unavailable.' },
            projects: { status: 'needs_improvement', feedback: 'Resume quality analysis was unavailable.' },
            overallFeedback: 'Resume uploaded successfully, but AI quality feedback could not be generated.'
        };
    }

    try {
        const prompt = `
Analyze this resume for quality improvement.

Check specifically:
1. Quantifiable achievements and measurable outcomes.
2. Technical skills.
3. Relevant projects.

Give actionable feedback, not a numeric score.

Return ONLY valid JSON in this format:
{
  "quantifiableAchievements": { "status": "good", "feedback": "..." },
  "technicalSkills": { "status": "needs_improvement", "feedback": "..." },
  "projects": { "status": "good", "feedback": "..." },
  "overallFeedback": "..."
}

Note: The "status" property must be either "good" or "needs_improvement".

Resume text:
${text}
`;

        let configuredModel = process.env.GEMINI_MODEL;
        if (configuredModel && (configuredModel.includes('3.8') || configuredModel.includes('3.5'))) {
            configuredModel = null;
        }

        const candidateModels = [
            configuredModel,
            process.env.GEMINI_FALLBACK_MODEL,
            'gemini-2.5-flash',
            'gemini-2.0-flash',
            'gemini-1.5-flash'
        ].filter(Boolean);

        const modelsToTry = [...new Set(candidateModels)];
        const client = customClient || ai || new GoogleGenAI({ apiKey });

        let response = null;
        let lastError = null;

        for (const model of modelsToTry) {
            try {
                response = await client.models.generateContent({
                    model,
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    config: { responseMimeType: 'application/json' }
                });
                if (response && response.text) break;
            } catch (err) {
                lastError = err;
                console.warn(`[ResumeQuality] Model ${model} failed (${err.message || err}). Trying fallback model...`);
            }
        }

        if (!response) {
            throw lastError || new Error('All Gemini AI models failed for resume quality analysis');
        }

        const rawText = (response && response.text) ? response.text : '{}';
        let cleanedText = rawText.replace(/```(?:json)?\n?([\s\S]*?)```/g, '$1').replace(/```json|```/g, '').trim();
        const firstBrace = cleanedText.indexOf('{');
        const lastBrace = cleanedText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            cleanedText = cleanedText.substring(firstBrace, lastBrace + 1);
        }

        const parsed = JSON.parse(cleanedText);

        return {
            quantifiableAchievements: {
                status: parsed?.quantifiableAchievements?.status || 'needs_improvement',
                feedback: parsed?.quantifiableAchievements?.feedback || 'Resume quality analysis was unavailable.'
            },
            technicalSkills: {
                status: parsed?.technicalSkills?.status || 'needs_improvement',
                feedback: parsed?.technicalSkills?.feedback || 'Resume quality analysis was unavailable.'
            },
            projects: {
                status: parsed?.projects?.status || 'needs_improvement',
                feedback: parsed?.projects?.feedback || 'Resume quality analysis was unavailable.'
            },
            overallFeedback: parsed?.overallFeedback || 'Resume uploaded successfully.'
        };
    } catch (error) {
        console.error('Error analyzing resume quality with Gemini AI:', error.message || error);
        return {
            quantifiableAchievements: { status: 'needs_improvement', feedback: 'Resume quality analysis was unavailable.' },
            technicalSkills: { status: 'needs_improvement', feedback: 'Resume quality analysis was unavailable.' },
            projects: { status: 'needs_improvement', feedback: 'Resume quality analysis was unavailable.' },
            overallFeedback: 'Resume uploaded successfully, but AI quality feedback could not be generated.'
        };
    }
}

router.get('/candidate/profile', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const userId = req.user._id || req.user.id;
        const [freshUser, candidateVerification, activeApplicationsCount, latestSession] = await Promise.all([
            User.findById(userId),
            CandidateVerification.findOne({ candidate: userId }).select('status reviewerReason submittedAt reviewedAt'),
            Application.countDocuments({ candidate: userId, status: { $nin: ['Withdrawn', 'withdrawn', 'Rejected'] } }),
            MockInterviewSession.findOne({ candidate: userId, status: 'Completed' }).sort({ createdAt: -1 })
        ]);
        res.render('candidate/candidate-profile', {
            user: freshUser,
            candidate: freshUser,
            candidateVerification,
            skillProfiles: buildSkillProfiles(freshUser),
            profileCompletion: calculateProfileCompletion(freshUser),
            activeApplicationsCount,
            savedInternshipsCount: (freshUser && Array.isArray(freshUser.savedInternships)) ? freshUser.savedInternships.length : 0,
            latestSession
        });
    } catch (error) {
        console.error('Error loading candidate profile:', error);
        res.status(500).send('Database Error');
    }
});

router.get('/candidate/resume-builder', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const userId = req.user._id || req.user.id;
        const candidate = await User.findById(userId);

        res.render('candidate/resume-builder', { candidate });
    } catch (error) {
        console.error('Error loading resume builder:', error);
        res.status(500).send('Database Error');
    }
});

router.post('/candidate/profile/edit', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const {
            location,
            age,
            familyIncome,
            qualification,
            institution,
            enrollmentStatus,
            employmentStatus
        } = req.body;

        const parsedSkillProfiles = parseSkillProfiles(req.body);
        const skillsArray = skillNames(null, parsedSkillProfiles);

        const userId = req.user._id || req.user.id;

        let district = '';
        let state = '';
        if (location) {
            const parts = location.split(',').map(s => s.trim());
            district = parts[0] || '';
            state = parts.slice(1).join(', ') || '';
        }

        const parsedAge = (age !== undefined && age !== null && age !== '' && !isNaN(Number(age))) ? Number(age) : null;
        const parsedIncome = (familyIncome !== undefined && familyIncome !== null && familyIncome !== '' && !isNaN(Number(familyIncome))) ? Number(familyIncome) : null;

        await User.findByIdAndUpdate(
            userId,
            {
                $set: {
                    age: parsedAge,
                    familyIncome: parsedIncome,
                    institution: institution || '',
                    'education.institutionName': institution || '',
                    skills: skillsArray,
                    skillProfiles: parsedSkillProfiles,
                    'location.district': district,
                    'location.state': state,
                    'education.qualification': qualification || '',
                    qualification: qualification || '',
                    enrollmentStatus: (enrollmentStatus || '').trim(),
                    employmentStatus: (employmentStatus || '').trim()
                }
            },
            { returnDocument: 'after', runValidators: false }
        );

        await Recommendation.deleteMany({ candidate: userId });

        if (req.flash) req.flash('success_msg', 'Profile updated successfully!');
        res.redirect('/candidate/profile');
    } catch (error) {
        console.error('Error updating candidate profile:', error);
        if (req.flash) req.flash('error_msg', 'Failed to update profile. Please try again.');
        res.redirect('/candidate/profile');
    }
});

router.post('/candidate/parse-resume', isAuthenticated, authorize('candidate'), (req, res, next) => {
    upload.single('resume')(req, res, (err) => {
        if (err) {
            let errorMsg = 'File upload failed.';
            if (err.code === 'LIMIT_FILE_SIZE') {
                errorMsg = 'Resume file is too large. Maximum allowed size is 5MB.';
            } else if (err.code === 'INVALID_FILE_TYPE' || err.message) {
                errorMsg = err.message;
            }
            if (req.flash) req.flash('error_msg', errorMsg);
            return res.redirect('/candidate/profile');
        }
        next();
    });
}, async (req, res) => {
    try {
        if (!req.file) {
            if (req.flash) req.flash('error_msg', 'Please select a valid PDF or Word resume to upload.');
            return res.redirect('/candidate/profile');
        }

        const uploadToCloudinary = (file) => {
            return new Promise((resolve, reject) => {
                const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
                const publicId = `internpilot/resumes/${Date.now()}_${safeName}`;

                const uploadStream = cloudinary.uploader.upload_stream(
                    { public_id: publicId, resource_type: 'raw', disable_promises: true },
                    (error, result) => {
                        if (error) reject(error);
                        else resolve(result);
                    }
                );
                uploadStream.on('error', (error) => reject(error));
                uploadStream.end(file.buffer);
            });
        };

        const resumeOriginalName = req.file.originalname;
        const resumeVersionLabel = req.body.resumeLabel || '';
        const resumeUploadedAt = new Date();
        let resumeUrl = '';

        try {
            const cloudinaryResult = await uploadToCloudinary(req.file);
            resumeUrl = cloudinaryResult.secure_url;
        } catch (cloudErr) {
            console.warn('Cloudinary upload failed, falling back to local file storage:', cloudErr.message || cloudErr);
            const safeName = req.file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
            const uniqueFileName = `${Date.now()}_${safeName}`;
            const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'resumes');
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }
            const localFilePath = path.join(uploadDir, uniqueFileName);
            fs.writeFileSync(localFilePath, req.file.buffer);
            resumeUrl = `/uploads/resumes/${uniqueFileName}`;
        }

        let text = '';
        try {
            const isPdf = req.file.mimetype === 'application/pdf' ||
                req.file.mimetype === 'application/x-pdf' ||
                (req.file.originalname || '').toLowerCase().endsWith('.pdf');
            if (isPdf) {
                text = await extractPdfText(req.file.buffer);
            } else {
                text = await extractDocxText(req.file.buffer);
            }
        } catch (extractError) {
            console.warn('Text extraction warning:', extractError);
        }

        const skillBank = [
            'JavaScript', 'Node.js', 'Express', 'React', 'Vue', 'Angular', 'HTML', 'CSS', 'Tailwind',
            'Python', 'Java', 'C++', 'C#', 'SQL', 'MongoDB', 'PostgreSQL', 'Git', 'Docker',
            'Communication', 'Problem Solving', 'Data Analysis', 'Machine Learning', 'Excel'
        ];

        const extractedSkills = skillBank.filter(skill => {
            const escaped = escapeRegExp(skill);
            const regex = new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`, 'i');
            return regex.test(text);
        });

        let extractedQualification = '';
        if (/B\.?Tech|Bachelor of Technology/i.test(text)) extractedQualification = 'B.Tech';
        else if (/M\.?Tech|Master of Technology/i.test(text)) extractedQualification = 'M.Tech';
        else if (/B\.?Sc|Bachelor of Science/i.test(text)) extractedQualification = 'B.Sc';
        else if (/BCA|Bachelor of Computer Applications/i.test(text)) extractedQualification = 'BCA';
        else if (/MCA|Master of Computer Applications/i.test(text)) extractedQualification = 'MCA';

        const resumeQuality = await analyzeResumeQuality(text);

        await recordResumeParse(req, {
            resumeUrl,
            fileName: resumeOriginalName,
            text,
            skills: extractedSkills,
            qualification: extractedQualification
        });

        const parsedData = {};
        if (extractedSkills.length > 0) parsedData.skills = extractedSkills;
        if (extractedQualification) {
            parsedData.education = { qualification: extractedQualification };
        }

        const userId = req.user._id || req.user.id;
        const existingProfile = await User.findById(userId);

        const { hasConflicts, conflicts, autoMerged } = detectProfileConflicts(
            existingProfile,
            parsedData
        );

        if (hasConflicts) {
            return res.render('candidate/candidate-profile', {
                user: existingProfile,
                candidate: existingProfile,
                conflicts,
                autoMerged,
                resumeUrl,
                resumeOriginalName,
                resumeVersionLabel,
                resumeQuality,
                showConflictModal: true,
                profileCompletion: calculateProfileCompletion(existingProfile)
            });
        }

        const updateDoc = {
            $set: {
                resume: resumeUrl,
                resumeOriginalName,
                resumeUploadedAt,
                resumeQuality
            }
        };

        for (const [key, value] of Object.entries(autoMerged)) {
            if (key === 'skills') {
                updateDoc.$addToSet = { skills: { $each: Array.isArray(value) ? value : [value] } };
            } else {
                updateDoc.$set[key] = value;
            }
        }

        if (extractedSkills.length > 0 && !autoMerged.skills) {
            updateDoc.$addToSet = updateDoc.$addToSet || {};
            updateDoc.$addToSet.skills = { $each: extractedSkills };
        }

        await User.findByIdAndUpdate(userId, updateDoc);
        await storeResumeVersion(userId, resumeVersionPayload({
            label: resumeVersionLabel,
            fileUrl: resumeUrl,
            fileName: resumeOriginalName,
            text,
            createdAt: resumeUploadedAt
        }));
        await Recommendation.deleteMany({ candidate: userId });
        if (req.flash) req.flash('success_msg', 'Resume uploaded successfully! Your profile details have been synced.');

        res.redirect('/candidate/profile');
    } catch (error) {
        console.error('Error uploading/parsing resume:', error);
        let errorMsg = 'Failed to process resume upload. Please try again.';
        const msg = error.message || '';
        if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED' || /timeout|network|connect|econn/i.test(msg)) {
            errorMsg = 'Network error while uploading resume. Please check your internet connection and try again.';
        } else if (/cloudinary/i.test(msg) || error.http_code) {
            errorMsg = 'Cloud storage service error while saving resume. Please try again later.';
        } else if (msg) {
            errorMsg = `Resume upload failed: ${msg}`;
        }
        if (req.flash) req.flash('error_msg', errorMsg);
        res.redirect('/candidate/profile');
    }
});

router.post('/candidate/profile/confirm-update', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const userId = req.user._id || req.user.id;
        const existingProfile = await User.findById(userId);
        if (!existingProfile) {
            if (req.flash) req.flash('error_msg', 'Profile not found.');
            return res.redirect('/candidate/profile');
        }

        let autoMerged = {};
        try {
            autoMerged = JSON.parse(req.body.autoMerged || '{}');
        } catch (_) {  }

        let resumeQuality = null;
        try {
            if (req.body.resumeQuality) {
                resumeQuality = JSON.parse(req.body.resumeQuality);
            }
        } catch (_) {  }

        const resumeUrl = req.body.resumeUrl || '';
        const resumeOriginalName = req.body.resumeOriginalName || '';
        const resumeVersionLabel = req.body.resumeVersionLabel || '';

        const updateDoc = { $set: {} };

        if (resumeUrl) {
            updateDoc.$set.resume = resumeUrl;
            if (resumeOriginalName) updateDoc.$set.resumeOriginalName = resumeOriginalName;
            updateDoc.$set.resumeUploadedAt = new Date();
        }
        if (resumeQuality) updateDoc.$set.resumeQuality = resumeQuality;

        for (const [key, value] of Object.entries(autoMerged)) {
            if (key === 'skills') {
                updateDoc.$addToSet = { skills: { $each: Array.isArray(value) ? value : [value] } };
            } else {
                updateDoc.$set[key] = value;
            }
        }

        for (const bodyKey of Object.keys(req.body)) {
            if (!bodyKey.startsWith('field_') || bodyKey.endsWith('_mobile')) continue;

            const fieldKey = bodyKey.replace('field_', '');
            const choice = req.body[bodyKey];

            if (choice === 'parsed') {
                const parsedVal = req.body[`parsedValue_${fieldKey}`];
                if (parsedVal !== undefined && parsedVal !== '') {
                    if (fieldKey === 'skills') {
                        updateDoc.$set.skills = parsedVal.split(',').map(s => s.trim()).filter(Boolean);
                    } else if (fieldKey === 'education.institutionName') {
                        updateDoc.$set['education.institutionName'] = parsedVal;
                        updateDoc.$set.institution = parsedVal;
                    } else {
                        updateDoc.$set[fieldKey] = parsedVal;
                    }
                }
            }
        }

        if (updateDoc.$set['education.institutionName'] && !updateDoc.$set.institution) {
            updateDoc.$set.institution = updateDoc.$set['education.institutionName'];
        }

        await User.findByIdAndUpdate(userId, updateDoc, { runValidators: false });
        if (resumeUrl) {
            await storeResumeVersion(userId, resumeVersionPayload({
                label: resumeVersionLabel,
                fileUrl: resumeUrl,
                fileName: resumeOriginalName,
                createdAt: updateDoc.$set.resumeUploadedAt
            }));
        }
        await Recommendation.deleteMany({ candidate: userId });
        if (req.flash) req.flash('success_msg', 'Resume uploaded successfully! Your profile has been updated with your selected choices.');
        res.redirect('/candidate/profile');
    } catch (error) {
        console.error('Error confirming profile update:', error);
        if (req.flash) req.flash('error_msg', 'Failed to save profile changes. Please try again.');
        res.redirect('/candidate/profile');
    }
});

router.post('/candidate/resume/delete', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const userId = req.user._id || req.user.id;
        await User.findByIdAndUpdate(userId, {
            $set: {
                resume: '',
                resumeOriginalName: '',
                resumeUploadedAt: null,
                resumeQuality: null
            }
        });
        if (req.flash) req.flash('success_msg', 'Resume removed successfully from your profile.');
        res.redirect('/candidate/profile');
    } catch (error) {
        console.error('Error removing resume:', error);
        if (req.flash) req.flash('error_msg', 'Failed to remove resume. Please try again.');
        res.redirect('/candidate/profile');
    }
});

router.post('/candidate/profile/resume-versions/:versionId/default', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const userId = req.user._id || req.user.id;
        const user = await User.findById(userId);
        const selected = user && user.resumeVersions && user.resumeVersions.id(req.params.versionId);
        if (!selected) {
            if (req.flash) req.flash('error_msg', 'Resume version not found.');
            return res.redirect('/candidate/profile');
        }

        user.resumeVersions.forEach(version => { version.isDefault = String(version._id) === String(selected._id); });
        user.resume = selected.fileUrl;
        user.resumeOriginalName = selected.fileName || selected.label;
        user.resumeUploadedAt = selected.createdAt || new Date();
        await user.save();

        if (req.flash) req.flash('success_msg', 'Default resume version updated.');
        return res.redirect('/candidate/profile');
    } catch (error) {
        console.error('Error selecting resume version:', error);
        if (req.flash) req.flash('error_msg', 'Unable to select that resume version.');
        return res.redirect('/candidate/profile');
    }
});

router.post('/candidate/profile/resume-versions/:versionId/delete', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const userId = req.user._id || req.user.id;
        const user = await User.findById(userId);
        const version = user && user.resumeVersions && user.resumeVersions.id(req.params.versionId);
        if (!version) {
            if (req.flash) req.flash('error_msg', 'Resume version not found.');
            return res.redirect('/candidate/profile');
        }

        const wasDefault = Boolean(version.isDefault) || String(user.resume || '') === String(version.fileUrl || '');
        user.resumeVersions.pull(req.params.versionId);

        if (wasDefault) {
            const replacement = user.resumeVersions[0];
            user.resume = replacement ? replacement.fileUrl : '';
            user.resumeOriginalName = replacement ? (replacement.fileName || replacement.label) : '';
            user.resumeUploadedAt = replacement ? (replacement.createdAt || new Date()) : null;
            user.resumeVersions.forEach((entry, index) => { entry.isDefault = index === 0; });
        }
        await user.save();

        if (req.flash) req.flash('success_msg', 'Resume version removed.');
        return res.redirect('/candidate/profile');
    } catch (error) {
        console.error('Error removing resume version:', error);
        if (req.flash) req.flash('error_msg', 'Unable to remove that resume version.');
        return res.redirect('/candidate/profile');
    }
});

module.exports = router;

