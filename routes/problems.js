const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const ResumeProblemSet = require('../models/ResumeProblemSet');
const User = require('../models/User');
const { isAuthenticated, authorize } = require('../middleware/auth');
const aiClient = require('../utils/aiClient');

const MAX_GENERATIONS_PER_DAY = 5;

const extractionSchema = {
    type: "OBJECT",
    properties: {
        skills: { type: "ARRAY", items: { type: "STRING" } },
        projects: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    title: { type: "STRING" },
                    description: { type: "STRING" },
                    technologies: { type: "ARRAY", items: { type: "STRING" } }
                },
                required: ["title", "description"]
            }
        },
        achievements: { type: "ARRAY", items: { type: "STRING" } },
        domain: { type: "STRING" }
    },
    required: ["skills", "projects", "achievements", "domain"]
};

const problemGenerationSchema = {
    type: "ARRAY",
    items: {
        type: "OBJECT",
        properties: {
            title: { type: "STRING" },
            scenario: { type: "STRING" },
            constraints: { type: "ARRAY", items: { type: "STRING" } },
            objective: { type: "STRING" },
            difficulty: { type: "STRING", enum: ["Entry", "Mid", "Senior"] },
            relevantResumeEvidence: { type: "STRING" },
            targetedQuestions: { type: "ARRAY", items: { type: "STRING" } }
        },
        required: ["title", "scenario", "constraints", "objective", "difficulty", "relevantResumeEvidence", "targetedQuestions"]
    }
};


router.get('/problems', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const problemSets = await ResumeProblemSet.find({ candidate: req.user._id }).sort({ createdAt: -1 });
        const user = await User.findById(req.user._id).select('resumeVersions').lean();
        res.render('problems/hub', { problemSets, resumeVersions: (user && user.resumeVersions) || [], pageTitle: 'Problem Generator' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});


router.post('/problems/extract', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const { resumeVersionId } = req.body;
        if (!resumeVersionId || !mongoose.Types.ObjectId.isValid(resumeVersionId)) {
            return res.status(400).json({ error: 'Valid resume selection required.' });
        }

        const user = await User.findById(req.user._id).select('resumeVersions').lean();
        const resumeVersions = (user && user.resumeVersions) || [];
        const resume = resumeVersions.find(r => r && r._id && r._id.toString() === resumeVersionId.toString());
        
        if (!resume || !resume.text) {
            return res.status(400).json({ error: 'Valid resume text not found' });
        }

        const prompt = `Extract structured information from the following resume.
Do NOT output any internal chain-of-thought or reasoning. Only extract the required schema fields.

=== RESUME START ===
${resume.text}
=== RESUME END ===`;

        let extraction;
        try {
            extraction = await aiClient.generateJsonWithRetry(prompt, extractionSchema, ['skills', 'projects', 'achievements']);
        } catch (aiErr) {
            console.error('AI Extraction Error:', aiErr);
            return res.status(500).json({ error: 'Failed to extract resume data.' });
        }

        res.json({ extraction, resumeVersionId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});


router.post('/problems/generate', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const count = await ResumeProblemSet.countDocuments({ candidate: req.user._id, createdAt: { $gte: today } });
        
        if (count >= MAX_GENERATIONS_PER_DAY) {
            return res.status(429).json({ error: 'Daily limit of 5 problem generations reached.' });
        }

        const { resumeVersionId, projectFocused } = req.body;
        if (!resumeVersionId || !mongoose.Types.ObjectId.isValid(resumeVersionId)) {
            return res.status(400).json({ error: 'Valid resume selection required.' });
        }
        
        const user = await User.findById(req.user._id).select('resumeVersions').lean();
        const resumeVersions = (user && user.resumeVersions) || [];
        const resume = resumeVersions.find(r => r && r._id && r._id.toString() === resumeVersionId.toString());
        
        if (!resume || !resume.text) {
            return res.status(400).json({ error: 'Valid resume text not found' });
        }

        const prompt = `You are an expert technical interviewer. Generate 2-3 personalized problem statements based on the candidate's resume, specifically focusing on the project/experience described as: "${projectFocused || 'General Experience'}".
        
Make the problems highly specific to the technologies and achievements they listed.
Do NOT output any internal chain-of-thought or reasoning.

=== RESUME START ===
${resume.text}
=== RESUME END ===`;

        let generatedProblems;
        try {
            generatedProblems = await aiClient.generateJsonWithRetry(prompt, problemGenerationSchema);
        } catch (aiErr) {
            console.error('AI Gen Error:', aiErr);
            return res.status(500).json({ error: 'Failed to generate problems.' });
        }

        if (!Array.isArray(generatedProblems)) {
            generatedProblems = [generatedProblems];
        }

        const problemSet = new ResumeProblemSet({
            candidate: req.user._id,
            sourceResumeId: resumeVersionId,
            problems: generatedProblems
        });
        await problemSet.save();

        res.json({ success: true, problemSetId: problemSet._id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});


router.get('/problems/set/:id', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).send('Problem set not found');
        }
        const problemSet = await ResumeProblemSet.findOne({ _id: req.params.id, candidate: req.user._id });
        if (!problemSet) return res.status(404).send('Problem set not found');
        
        res.render('problems/workspace', { problemSet, pageTitle: 'Problem Workspace' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});


router.post('/problems/set/:setId/submit/:problemId', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.setId)) {
            return res.status(404).json({ error: 'Problem set not found' });
        }
        const { solution } = req.body;
        const problemSet = await ResumeProblemSet.findOne({ _id: req.params.setId, candidate: req.user._id });
        if (!problemSet) return res.status(404).json({ error: 'Problem set not found' });
        
        const problem = problemSet.problems.id(req.params.problemId);
        if (!problem) return res.status(404).json({ error: 'Problem not found' });
        
        problem.candidateSolution = solution;
        problem.submittedAt = new Date();
        await problemSet.save();

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

module.exports = router;



