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

function resumeVersionPayload({ label, fileUrl, fileName, createdAt = new Date() }) {
    const normalizedLabel = typeof label === 'string' ? label.trim().slice(0, 100) : '';
    const normalizedFileName = typeof fileName === 'string' ? fileName.trim().slice(0, 180) : '';
    return {
        label: normalizedLabel || normalizedFileName || 'Resume version',
        fileUrl,
        fileName: normalizedFileName,
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
            quantifiableAchievements: {
                status: 'needs_improvement',
                feedback: 'Resume text could not be extracted.'
            },
            technicalSkills: {
                status: 'needs_improvement',
                feedback: 'Resume text could not be extracted.'
            },
            projects: {
                status: 'needs_improvement',
                feedback: 'Resume text could not be extracted.'
            },
            overallFeedback: 'Resume uploaded successfully, but text could not be read for AI feedback.'
        };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey && !customClient) {
        console.warn('GEMINI_API_KEY is not configured in environment variables.');
        return {
            quantifiableAchievements: {
                status: 'needs_improvement',
                feedback: 'Resume quality analysis was unavailable.'
            },
            technicalSkills: {
                status: 'needs_improvement',
                feedback: 'Resume quality analysis was unavailable.'
            },
            projects: {
                status: 'needs_improvement',
                feedback: 'Resume quality analysis was unavailable.'
            },
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
  "quantifiableAchievements": {
    "status": "good",
    "feedback": "..."
  },
  "technicalSkills": {
    "status": "needs_improvement",
    "feedback": "..."
  },
  "projects": {
    "status": "good",
    "feedback": "..."
  },
  "overallFeedback": "..."
}

Note: The "status" property must be either "good" or "needs_improvement".

Resume text:
${text}
`;

        const modelName = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
        const client = customClient || ai || new GoogleGenAI({ apiKey });

        let response;
        try {
            response = await client.models.generateContent({
                model: modelName,
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                config: {
                    responseMimeType: 'application/json'
                }
            });
        } catch (callErr) {
            const isTransientError = callErr.status === 503 || (callErr.message && /high demand|temporar|503/i.test(callErr.message));
            if (isTransientError && modelName !== 'gemini-3.5-flash') {
                console.warn(`Model ${modelName} is experiencing high demand. Failing over to gemini-3.5-flash...`);
                response = await client.models.generateContent({
                    model: 'gemini-3.5-flash',
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    config: {
                        responseMimeType: 'application/json'
                    }
                });
            } else {
                throw callErr;
            }
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
                status: parsed && parsed.quantifiableAchievements && parsed.quantifiableAchievements.status ? parsed.quantifiableAchievements.status : 'needs_improvement',
                feedback: parsed && parsed.quantifiableAchievements && parsed.quantifiableAchievements.feedback ? parsed.quantifiableAchievements.feedback : 'Resume quality analysis was unavailable.'
            },
            technicalSkills: {
                status: parsed && parsed.technicalSkills && parsed.technicalSkills.status ? parsed.technicalSkills.status : 'needs_improvement',
                feedback: parsed && parsed.technicalSkills && parsed.technicalSkills.feedback ? parsed.technicalSkills.feedback : 'Resume quality analysis was unavailable.'
            },
            projects: {
                status: parsed && parsed.projects && parsed.projects.status ? parsed.projects.status : 'needs_improvement',
                feedback: parsed && parsed.projects && parsed.projects.feedback ? parsed.projects.feedback : 'Resume quality analysis was unavailable.'
            },
            overallFeedback: parsed && parsed.overallFeedback ? parsed.overallFeedback : 'Resume uploaded successfully.'
        };
    } catch (error) {
        console.error('Error analyzing resume quality with Gemini AI:', error.message || error);

        return {
            quantifiableAchievements: {
                status: 'needs_improvement',
                feedback: 'Resume quality analysis was unavailable.'
            },
            technicalSkills: {
                status: 'needs_improvement',
                feedback: 'Resume quality analysis was unavailable.'
            },
            projects: {
                status: 'needs_improvement',
                feedback: 'Resume quality analysis was unavailable.'
            },
            overallFeedback: 'Resume uploaded successfully, but AI quality feedback could not be generated.'
        };
    }
}

router.get('/candidate/profile', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const userId = req.user._id || req.user.id;
        const freshUser = await User.findById(userId);

        res.render('candidate/candidate-profile', {
            user: freshUser,
            candidate: freshUser
        });
    } catch (error) {
        console.error('Error fetching candidate profile:', error);
        res.status(500).send('Database Error');
    }
});

router.get('/candidate/resume-builder', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const userId = req.user._id || req.user.id;
        const candidate = await User.findById(userId);

        res.render('candidate/resume-builder', {
            candidate
        });
    } catch (error) {
        console.error('Error loading resume builder:', error);
        res.status(500).send('Database Error');
    }
});

router.post('/candidate/profile/edit', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const { location, age, familyIncome, qualification, institution, skills } = req.body;

        const skillsArray = skills
            ? skills.split(',').map(s => s.trim()).filter(Boolean)
            : [];

        const userId = req.user._id || req.user.id;

        let district = '';
        let state = '';
        if (location) {
            const parts = location.split(',').map(s => s.trim());
            district = parts[0] || '';
            state = parts[1] || '';
        }

        await User.findByIdAndUpdate(
            userId,
            {
                $set: {
                    age: age ? Number(age) : null,
                    familyIncome: familyIncome ? Number(familyIncome) : null,
                    institution: institution || '',
                    'education.institutionName': institution || '',
                    skills: skillsArray,
                    'location.district': district,
                    'location.state': state,
                    'education.qualification': qualification || ''
                }
            },
            { new: true, runValidators: false }
        );

        // Wipe recommendations cache to force AI regeneration with new skills
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
                    {
                        public_id: publicId,
                        resource_type: 'raw',
                        disable_promises: true
                    },
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
            console.warn('Text extraction warning:', extractError.message);
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

        // Keep what the parser found so the profile page can show it (#20).
        await recordResumeParse(req, {
            resumeUrl,
            fileName: resumeOriginalName,
            text,
            skills: extractedSkills,
            qualification: extractedQualification
        });

        // ── Build the parsed-data object for conflict detection ────
        const parsedData = {};
        if (extractedSkills.length > 0) parsedData.skills = extractedSkills;
        if (extractedQualification) {
            parsedData.education = { qualification: extractedQualification };
        }

        // ── Fetch existing profile and detect conflicts ────────────
        const userId = req.user._id || req.user.id;
        const existingProfile = await User.findById(userId);

        const { hasConflicts, conflicts, autoMerged } = detectProfileConflicts(
            existingProfile,
            parsedData
        );

        if (hasConflicts) {
            // Render the profile page with the conflict-resolution modal
            return res.render('candidate/candidate-profile', {
                user: existingProfile,
                candidate: existingProfile,
                conflicts,
                autoMerged,
                resumeUrl,
                resumeOriginalName,
                resumeVersionLabel,
                resumeQuality,
                showConflictModal: true
            });
        }

        // ── No conflicts: apply auto-merged fields + resume data ──
        const updateDoc = {
            $set: {
                resume: resumeUrl,
                resumeOriginalName,
                resumeUploadedAt,
                resumeQuality
            }
        };

        // Apply auto-merged fields
        for (const [key, value] of Object.entries(autoMerged)) {
            if (key === 'skills') {
                updateDoc.$addToSet = { skills: { $each: Array.isArray(value) ? value : [value] } };
            } else {
                updateDoc.$set[key] = value;
            }
        }

        // Also merge extracted skills that were not conflicting
        if (extractedSkills.length > 0 && !autoMerged.skills) {
            updateDoc.$addToSet = updateDoc.$addToSet || {};
            updateDoc.$addToSet.skills = { $each: extractedSkills };
        }

        await User.findByIdAndUpdate(userId, updateDoc);
        await storeResumeVersion(userId, resumeVersionPayload({
            label: resumeVersionLabel,
            fileUrl: resumeUrl,
            fileName: resumeOriginalName,
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

// ── Confirm & save profile after conflict resolution ──────────────────
router.post('/candidate/profile/confirm-update', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const userId = req.user._id || req.user.id;
        const existingProfile = await User.findById(userId);
        if (!existingProfile) {
            if (req.flash) req.flash('error_msg', 'Profile not found.');
            return res.redirect('/candidate/profile');
        }

        // Parse the auto-merged fields that were already resolved server-side
        let autoMerged = {};
        try {
            autoMerged = JSON.parse(req.body.autoMerged || '{}');
        } catch (_) { /* ignore malformed JSON */ }

        // Parse resume quality if present
        let resumeQuality = null;
        try {
            if (req.body.resumeQuality) {
                resumeQuality = JSON.parse(req.body.resumeQuality);
            }
        } catch (_) { /* ignore */ }

        const resumeUrl = req.body.resumeUrl || '';
        const resumeOriginalName = req.body.resumeOriginalName || '';
        const resumeVersionLabel = req.body.resumeVersionLabel || '';

        // ── Build the final update document ───────────────────────
        const updateDoc = { $set: {} };

        // Always save the resume URL and quality analysis
        if (resumeUrl) {
            updateDoc.$set.resume = resumeUrl;
            if (resumeOriginalName) updateDoc.$set.resumeOriginalName = resumeOriginalName;
            updateDoc.$set.resumeUploadedAt = new Date();
        }
        if (resumeQuality) updateDoc.$set.resumeQuality = resumeQuality;

        // Apply auto-merged fields
        for (const [key, value] of Object.entries(autoMerged)) {
            if (key === 'skills') {
                updateDoc.$addToSet = { skills: { $each: Array.isArray(value) ? value : [value] } };
            } else {
                updateDoc.$set[key] = value;
            }
        }

        // ── Process each conflict resolution from the form ────────
        // Form fields arrive as  field_<key> = "current" | "parsed"
        // We also need the parsed values — they were embedded in the
        // form via the conflict objects.  To avoid a second round-trip
        // to the AI, we stashed them in hidden inputs.  However, for
        // security we re-derive the "current" value from the DB and
        // only accept "parsed" when the user explicitly chose it.
        //
        // The parsedValues are passed through the autoMerged/conflicts
        // data; conflicts that the user chose "parsed" for need the
        // parsed value.  We store those in a separate hidden field.

        for (const bodyKey of Object.keys(req.body)) {
            if (!bodyKey.startsWith('field_')) continue;
            // Skip mobile duplicate radio names
            if (bodyKey.endsWith('_mobile')) continue;

            const fieldKey = bodyKey.replace('field_', '');
            const choice = req.body[bodyKey]; // 'current' or 'parsed'

            if (choice === 'parsed') {
                // The parsed value was serialized in a companion hidden input
                const parsedVal = req.body[`parsedValue_${fieldKey}`];
                if (parsedVal !== undefined && parsedVal !== '') {
                    if (fieldKey === 'skills') {
                        const skillsArr = parsedVal.split(',').map(s => s.trim()).filter(Boolean);
                        updateDoc.$set.skills = skillsArr;
                    } else if (fieldKey === 'education.institutionName') {
                        updateDoc.$set['education.institutionName'] = parsedVal;
                        updateDoc.$set.institution = parsedVal;
                    } else {
                        updateDoc.$set[fieldKey] = parsedVal;
                    }
                }
            }
            // choice === 'current' → we keep the existing DB value (no-op)
        }

        // Ensure institution stays in sync with education.institutionName
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

// ── Delete on-file resume ─────────────────────────────────────────────
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

// Select a historical resume version as the candidate's active/default one.
// Application snapshots keep their own file URL, so this never changes a
// previously submitted Application Kit.
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

// Remove a stored resume version. If the removed version was current, a
// remaining version becomes the default; immutable application snapshots are
// deliberately left intact.
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

function handleDocumentUpload(fieldName) {
    return (req, res, next) => {
        documentUpload.single(fieldName)(req, res, (err) => {
            if (err) {
                const message = err.code === 'LIMIT_FILE_SIZE'
                    ? 'File is too large. Maximum allowed size is 5MB.'
                    : (err.message || 'File upload failed.');
                if (req.flash) req.flash('error_msg', message);
                return res.redirect('/candidate/profile');
            }
            next();
        });
    };
}

function sanitizeLink(value) {
    const link = (value || '').trim();
    if (!link) return { link: '' };

    try {
        const parsed = new URL(link);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { error: 'Links must start with http:// or https://' };
        }
        return { link: parsed.toString() };
    } catch {
        return { error: 'Please enter a valid URL (e.g. https://example.com/certificate).' };
    }
}

function sanitizeIssueDate(value) {
    const raw = (value || '').trim();
    if (!raw) return { issueDate: null };

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
        return { error: 'Please enter a valid issue date.' };
    }
    if (parsed > new Date()) {
        return { error: 'Issue date cannot be in the future.' };
    }
    return { issueDate: parsed };
}

function parseTechStack(value) {
    return (value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
        .slice(0, 20);
}

async function storeDocument(file, folder) {
    if (!file) return null;
    try {
        const result = await uploadBufferToCloudinary(file, folder);
        return { fileUrl: result.secure_url, fileName: file.originalname };
    } catch (cloudErr) {
        console.warn('Cloudinary upload failed in storeDocument, falling back to local file storage:', cloudErr.message || cloudErr);
        const safeName = (file.originalname || 'document').replace(/[^a-zA-Z0-9_.-]/g, '_');
        const uniqueFileName = `${Date.now()}_${safeName}`;
        const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'documents');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        const localFilePath = path.join(uploadDir, uniqueFileName);
        fs.writeFileSync(localFilePath, file.buffer);
        return { fileUrl: `/uploads/documents/${uniqueFileName}`, fileName: file.originalname };
    }
}

function redirectWithError(req, res, message) {
    if (req.flash) req.flash('error_msg', message);
    return res.redirect('/candidate/profile');
}


router.post('/candidate/profile/certifications', isAuthenticated, authorize('candidate'),
    handleDocumentUpload('certificate'), async (req, res) => {
        try {
            const name = (req.body.name || '').trim();
            if (!name) return redirectWithError(req, res, 'Certification name is required.');
            if (name.length > 120) return redirectWithError(req, res, 'Certification name must be 120 characters or fewer.');

            const { link, error: linkError } = sanitizeLink(req.body.link);
            if (linkError) return redirectWithError(req, res, linkError);

            const { issueDate, error: dateError } = sanitizeIssueDate(req.body.issueDate);
            if (dateError) return redirectWithError(req, res, dateError);

            const certification = {
                name,
                issuer: (req.body.issuer || '').trim().slice(0, 120),
                link,
                issueDate: issueDate || undefined
            };

            const stored = await storeDocument(req.file, 'internpilot/certifications');
            if (stored) Object.assign(certification, stored);

            const userId = req.user._id || req.user.id;
            await User.findByIdAndUpdate(userId, { $push: { certifications: certification } });

            if (req.flash) req.flash('success_msg', 'Certification added successfully!');
            res.redirect('/candidate/profile');
        } catch (error) {
            console.error('Error adding certification:', error);
            redirectWithError(req, res, 'Failed to add certification. Please try again.');
        }
    });

router.put('/candidate/profile/certifications/:certId', isAuthenticated, authorize('candidate'),
    handleDocumentUpload('certificate'), async (req, res) => {
        try {
            const userId = req.user._id || req.user.id;
            const user = await User.findById(userId);
            const certification = user && user.certifications.id(req.params.certId);
            if (!certification) return redirectWithError(req, res, 'Certification not found.');

            const name = (req.body.name || '').trim();
            if (!name) return redirectWithError(req, res, 'Certification name is required.');
            if (name.length > 120) return redirectWithError(req, res, 'Certification name must be 120 characters or fewer.');

            const { link, error: linkError } = sanitizeLink(req.body.link);
            if (linkError) return redirectWithError(req, res, linkError);

            const { issueDate, error: dateError } = sanitizeIssueDate(req.body.issueDate);
            if (dateError) return redirectWithError(req, res, dateError);

            certification.name = name;
            certification.issuer = (req.body.issuer || '').trim().slice(0, 120);
            certification.link = link;
            certification.issueDate = issueDate || undefined;

            const stored = await storeDocument(req.file, 'internpilot/certifications');
            if (stored) {
                certification.fileUrl = stored.fileUrl;
                certification.fileName = stored.fileName;
            }

            await user.save();
            if (req.flash) req.flash('success_msg', 'Certification updated successfully!');
            res.redirect('/candidate/profile');
        } catch (error) {
            console.error('Error updating certification:', error);
            redirectWithError(req, res, 'Failed to update certification. Please try again.');
        }
    });

router.delete('/candidate/profile/certifications/:certId', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const userId = req.user._id || req.user.id;
        const user = await User.findById(userId).select('certifications');
        if (!user || !user.certifications.id(req.params.certId)) {
            return redirectWithError(req, res, 'Certification not found.');
        }

        await User.findByIdAndUpdate(userId, { $pull: { certifications: { _id: req.params.certId } } });

        if (req.flash) req.flash('success_msg', 'Certification removed.');
        res.redirect('/candidate/profile');
    } catch (error) {
        console.error('Error deleting certification:', error);
        redirectWithError(req, res, 'Failed to remove certification. Please try again.');
    }
});


router.post('/candidate/profile/projects', isAuthenticated, authorize('candidate'),
    handleDocumentUpload('attachment'), async (req, res) => {
        try {
            const title = (req.body.title || '').trim();
            if (!title) return redirectWithError(req, res, 'Project title is required.');
            if (title.length > 120) return redirectWithError(req, res, 'Project title must be 120 characters or fewer.');

            const { link, error: linkError } = sanitizeLink(req.body.link);
            if (linkError) return redirectWithError(req, res, linkError);

            const project = {
                title,
                description: (req.body.description || '').trim().slice(0, 1000),
                link,
                techStack: parseTechStack(req.body.techStack)
            };

            const stored = await storeDocument(req.file, 'internpilot/projects');
            if (stored) Object.assign(project, stored);

            const userId = req.user._id || req.user.id;
            await User.findByIdAndUpdate(userId, { $push: { projects: project } });

            if (req.flash) req.flash('success_msg', 'Project added successfully!');
            res.redirect('/candidate/profile');
        } catch (error) {
            console.error('Error adding project:', error);
            redirectWithError(req, res, 'Failed to add project. Please try again.');
        }
    });

router.put('/candidate/profile/projects/:projectId', isAuthenticated, authorize('candidate'),
    handleDocumentUpload('attachment'), async (req, res) => {
        try {
            const userId = req.user._id || req.user.id;
            const user = await User.findById(userId);
            const project = user && user.projects.id(req.params.projectId);
            if (!project) return redirectWithError(req, res, 'Project not found.');

            const title = (req.body.title || '').trim();
            if (!title) return redirectWithError(req, res, 'Project title is required.');
            if (title.length > 120) return redirectWithError(req, res, 'Project title must be 120 characters or fewer.');

            const { link, error: linkError } = sanitizeLink(req.body.link);
            if (linkError) return redirectWithError(req, res, linkError);

            project.title = title;
            project.description = (req.body.description || '').trim().slice(0, 1000);
            project.link = link;
            project.techStack = parseTechStack(req.body.techStack);

            const stored = await storeDocument(req.file, 'internpilot/projects');
            if (stored) {
                project.fileUrl = stored.fileUrl;
                project.fileName = stored.fileName;
            }

            await user.save();
            if (req.flash) req.flash('success_msg', 'Project updated successfully!');
            res.redirect('/candidate/profile');
        } catch (error) {
            console.error('Error updating project:', error);
            redirectWithError(req, res, 'Failed to update project. Please try again.');
        }
    });

router.delete('/candidate/profile/projects/:projectId', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const userId = req.user._id || req.user.id;
        const user = await User.findById(userId).select('projects');
        if (!user || !user.projects.id(req.params.projectId)) {
            return redirectWithError(req, res, 'Project not found.');
        }

        await User.findByIdAndUpdate(userId, { $pull: { projects: { _id: req.params.projectId } } });

        if (req.flash) req.flash('success_msg', 'Project removed.');
        res.redirect('/candidate/profile');
    } catch (error) {
        console.error('Error deleting project:', error);
        redirectWithError(req, res, 'Failed to remove project. Please try again.');
    }
});

router.get('/candidate/applications', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const userId = req.user._id || req.user.id;
        const candidate = await User.findById(userId);

        const searchQuery = (req.query.search || '').trim();
        const statusFilter = (req.query.status || 'all').trim();
        const sortOrder = (req.query.sort || 'applied_desc').trim();

        const allApplications = await Application.find({ candidate: userId });
        const stats = {
            total: allApplications.length,
            submitted: allApplications.filter(a => a.status === 'Submitted').length,
            underReview: allApplications.filter(a => a.status === 'Under Review').length,
            shortlisted: allApplications.filter(a => a.status === 'Shortlisted').length,
            rejected: allApplications.filter(a => a.status === 'Rejected').length
        };

        let query = { candidate: userId };

        if (statusFilter !== 'all') {
            if (statusFilter.toLowerCase() === 'submitted') {
                query.status = { $in: ['Submitted', 'pending'] };
            } else {
                query.status = new RegExp('^' + statusFilter.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '$', 'i');
            }
        }

        if (searchQuery) {
            const escapeRegex = (text) => text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
            const regex = new RegExp(escapeRegex(searchQuery), 'gi');

            const matchingInternships = await Internship.find({
                $or: [{ title: regex }, { companyName: regex }, { company: regex }]
            }).select('_id');

            const internshipIds = matchingInternships.map(i => i._id);
            query.internship = { $in: internshipIds };
        }

        let sortObj = { appliedAt: -1, _id: -1 };
        if (sortOrder === 'applied_asc') {
            sortObj = { appliedAt: 1, _id: 1 };
        } else if (sortOrder === 'updated_desc') {
            sortObj = { statusUpdatedAt: -1, _id: -1 };
        } else if (sortOrder === 'match_desc') {
            sortObj = { matchScore: -1, _id: -1 };
        }

        const applications = await Application.find(query)
            .populate('internship')
            .sort(sortObj);

        res.render('candidate/candidate-tracker', {
            candidate,
            applications,
            stats,
            searchQuery,
            statusFilter,
            sortOrder,
            sanitizeHttpUrl,
            formatRelativeTime,
            formatLocalizedDateTime
        });

    } catch (error) {
        console.error('Error fetching tracker data:', error);
        res.status(500).send('Database Error');
    }
});

router.get('/recommendations/:userId', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const { userId } = req.params;

        // IDOR Protection: Candidates can only access their own recommendations
        if (req.user._id.toString() !== userId) {
            if (req.flash) req.flash('error_msg', 'You are not authorized to view recommendations for other candidates.');
            return res.redirect(`/recommendations/${req.user._id}`);
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).send('Candidate profile not found.');
        }

        const isAgeValid = user.age >= 21 && user.age <= 24;
        const isIncomeValid = user.familyIncome !== undefined && user.familyIncome !== null && user.familyIncome <= 800000;
        const isEligible = isAgeValid && isIncomeValid;

        const reasons = [];
        if (!isAgeValid) reasons.push(`Age (${user.age || 'N/A'}) falls outside the 21–24 permitted range.`);
        if (!isIncomeValid) reasons.push(`Family income (${user.familyIncome ? '₹' + user.familyIncome.toLocaleString('en-IN') : 'N/A'}) exceeds the ₹8,00,000 ceiling.`);

        const eligibility = { isEligible, reasons };

        // Fetch already applied IDs to exclude from read-time view
        const apps = await Application.find({ candidate: user._id }).select('internship');
        const appliedIds = apps.map(a => a.internship ? a.internship.toString() : null).filter(Boolean);

        // Fetch recommendations from DB
        let recommendations = await Recommendation.find({ candidate: user._id })
            .populate('internship')
            .sort({ aiMatchScore: -1 });

        let needsRegeneration = false;

        if (recommendations.length === 0) {
            needsRegeneration = true;
        } else {
            const firstGenTime = recommendations[0].generatedAt;
            const isFresh = firstGenTime && (new Date() - firstGenTime < 24 * 60 * 60 * 1000); // < 24h

            // Check if mixed generation or stale
            const isMixed = recommendations.some(r => !r.generatedAt || r.generatedAt.getTime() !== firstGenTime.getTime());

            if (!isFresh || isMixed) {
                needsRegeneration = true;
            }
        }

        if (needsRegeneration) {
            recommendations = await generateRecommendationsForUser(user);
            // Need to populate the internship for the newly generated ones
            recommendations = await Recommendation.populate(recommendations, { path: 'internship' });
        }

        // Filter out closed/paused/expired/applied at read-time
        const now = new Date();
        recommendations = recommendations.filter(rec => {
            const internship = rec.internship;
            if (!internship) return false; // Deleted internship
            if (internship.status !== 'published') return false;
            if (internship.isPaused) return false;
            if (appliedIds.includes(internship._id.toString())) return false;

            if (internship.applicationDeadline && internship.applicationDeadline < now) {
                return false;
            }
            return true;
        });

        // If after filtering we have nothing, and we didn't JUST regenerate, we could regenerate.
        // But if we just regenerated and it's still empty, it means there's literally no eligible internships.
        if (recommendations.length === 0 && !needsRegeneration) {
            recommendations = await generateRecommendationsForUser(user);
            recommendations = await Recommendation.populate(recommendations, { path: 'internship' });

            recommendations = recommendations.filter(rec => {
                const internship = rec.internship;
                if (!internship || internship.status !== 'published' || internship.isPaused) return false;
                if (appliedIds.includes(internship._id.toString())) return false;
                if (internship.applicationDeadline && internship.applicationDeadline < now) return false;
                return true;
            });
        }

        // Format for the EJS view (it expects { role: internship, matchScore: num, skillGapAnalysis, matchReasoning, isFallback })
        const formattedRecommendations = recommendations.map(rec => ({
            role: rec.internship,
            matchScore: rec.aiMatchScore,
            skillGapAnalysis: rec.skillGapAnalysis,
            matchReasoning: rec.matchReasoning,
            isFallback: rec.isFallback
        }));

        res.render('candidate/candidate-recommendations', { user, eligibility, recommendations: formattedRecommendations, appliedIds });
    } catch (error) {
        console.error('Error fetching recommendation dashboard:', error);
        res.status(500).send('Internal Server Error');
    }
});

router.analyzeResumeQuality = analyzeResumeQuality;

module.exports = router;
