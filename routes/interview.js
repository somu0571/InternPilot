const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const MockInterviewSession = require('../models/MockInterviewSession');
const User = require('../models/User');
const { isAuthenticated, authorize } = require('../middleware/auth');
const aiClient = require('../utils/aiClient');

const MAX_SESSIONS_PER_DAY = 3;
const MAX_TURNS = 10;
const MAX_HINTS = 3;
const MAX_REFRAMES = 3;

const interviewResponseSchema = {
    type: "OBJECT",
    properties: {
        action: { type: "STRING", description: "Must be one of: next_question, follow_up, finish" },
        question_text: { type: "STRING", description: "The text of the next question or follow-up question. Required if action is next_question or follow_up." },
        feedback_on_last_answer: { type: "STRING", description: "Brief constructive feedback on the candidate's last answer. Optional." }
    },
    required: ["action"]
};

const hintResponseSchema = {
    type: "OBJECT",
    properties: {
        hint_text: { type: "STRING", description: "A brief, encouraging hint to help the candidate answer the current question without giving away the direct answer." }
    },
    required: ["hint_text"]
};

const reframeResponseSchema = {
    type: "OBJECT",
    properties: {
        reframed_question: { type: "STRING", description: "The exact same underlying question, but phrased simpler or more explicitly." }
    },
    required: ["reframed_question"]
};

const evaluationResponseSchema = {
    type: "OBJECT",
    properties: {
        overallScore: { type: "INTEGER", description: "Overall score from 0 to 100" },
        strengths: { type: "ARRAY", items: { type: "STRING" } },
        improvements: { type: "ARRAY", items: { type: "STRING" } },
        feedback: { type: "STRING", description: "General summary feedback paragraph" }
        // Note: dimensionScores is added dynamically based on interview type
    },
    required: ["overallScore", "strengths", "improvements", "feedback"]
};

// Hub / Dashboard
router.get('/interview', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const sessions = await MockInterviewSession.find({ candidate: req.user._id }).sort({ createdAt: -1 });
        res.render('interview/hub', { sessions, pageTitle: 'Mock Interviews' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// Setup Form
router.get('/interview/setup', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('resumeVersions');
        res.render('interview/setup', { resumeVersions: user.resumeVersions, pageTitle: 'Configure Interview' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// Create Session
router.post('/interview/setup', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const count = await MockInterviewSession.countDocuments({ candidate: req.user._id, createdAt: { $gte: today } });
        
        if (count >= MAX_SESSIONS_PER_DAY) {
            return res.status(429).json({ error: 'Daily limit of 3 mock interviews reached. Please try again tomorrow.' });
        }

        const { role, experienceLevel, interviewType, mode, resumeReference } = req.body;

        if (!role || typeof role !== 'string' || !role.trim() ||
            !['Entry', 'Mid', 'Senior'].includes(experienceLevel) ||
            !['Technical', 'Behavioral', 'System Design', 'Resume Deep-Dive'].includes(interviewType) ||
            !['Timed', 'Self-Paced'].includes(mode)) {
            return res.status(400).json({ error: 'Please provide valid role, experience level, interview type, and mode.' });
        }

        let validResumeReference = null;
        if (resumeReference && mongoose.Types.ObjectId.isValid(resumeReference)) {
            const user = await User.findById(req.user._id).select('resumeVersions');
            const hasResume = (user?.resumeVersions || []).some(r => r && r._id && r._id.toString() === resumeReference.toString());
            if (hasResume) {
                validResumeReference = resumeReference;
            }
        }

        // Abandon existing in-progress sessions
        await MockInterviewSession.updateMany(
            { candidate: req.user._id, status: 'In Progress' },
            { $set: { status: 'Abandoned' } }
        );

        const session = new MockInterviewSession({
            candidate: req.user._id,
            role: role.trim(),
            experienceLevel,
            interviewType,
            mode,
            resumeReference: validResumeReference,
            status: 'In Progress'
        });
        await session.save();

        res.json({ success: true, sessionId: session._id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error creating session' });
    }
});

// Render Room
router.get('/interview/session/:id', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).send('Session not found');
        }
        const session = await MockInterviewSession.findOne({ _id: req.params.id, candidate: req.user._id });
        if (!session) return res.status(404).send('Session not found');
        
        res.render('interview/room', { session, pageTitle: `Interview: ${session.role}` });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// Submit Answer & Get Next Turn
router.post('/interview/session/:id/turn', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json({ error: 'Session not found' });
        }
        const { answer, durationSeconds } = req.body;
        const session = await MockInterviewSession.findOne({ _id: req.params.id, candidate: req.user._id });
        
        if (!session || session.status !== 'In Progress') {
            return res.status(400).json({ error: 'Invalid or completed session' });
        }

        // If there's an active question awaiting an answer, save the answer to it
        if (session.transcript.length > 0 && !session.transcript[session.transcript.length - 1].candidateAnswer) {
            session.transcript[session.transcript.length - 1].candidateAnswer = answer;
            session.transcript[session.transcript.length - 1].durationSeconds = durationSeconds || 0;
            session.transcript[session.transcript.length - 1].timestamp = new Date();
        }

        // Check turn limit
        if (session.usage.turns >= MAX_TURNS) {
            session.status = 'Completed';
            await session.save();
            return res.json({ action: 'finish', message: 'Maximum turns reached. Ending interview.' });
        }

        // Build Prompt Context
        let resumeContext = '';
        if (session.resumeReference) {
            const user = await User.findById(req.user._id).select('resumeVersions');
            const resumeVersions = (user && user.resumeVersions) || [];
            const resume = resumeVersions.find(r => r && r._id && r._id.toString() === session.resumeReference.toString());
            if (resume && resume.text) {
                resumeContext = `\n=== RESUME START ===\n${resume.text}\n=== RESUME END ===\n`;
            }
        }

        let transcriptText = session.transcript.map((t, i) => `Turn ${i+1}:\nQ: ${t.question}\nA: ${t.candidateAnswer || '[No Answer]'}`).join('\n\n');

        // Define the question blueprint based on interview type
        let blueprint = '';
        if (session.interviewType === 'Technical') {
            blueprint = 'Topics to cover sequentially: 1. Core language fundamentals, 2. Framework/Tooling knowledge, 3. Debugging/Problem solving, 4. Optimization/Performance.';
        } else if (session.interviewType === 'System Design') {
            blueprint = 'Topics to cover sequentially: 1. Requirements gathering, 2. High-level architecture, 3. Database schema/choice, 4. Scaling/Fault tolerance, 5. Trade-offs.';
        } else if (session.interviewType === 'Behavioral') {
            blueprint = 'Topics to cover sequentially: 1. Past challenges, 2. Conflict resolution, 3. Leadership/Initiative, 4. Adaptability. Ensure you guide the candidate to use the STAR method (Situation, Task, Action, Result). If their last answer missed a component, follow-up to ask for it.';
        } else if (session.interviewType === 'Resume Deep-Dive') {
            blueprint = 'Topics to cover sequentially: 1. Deep dive into most recent project, 2. Technical decisions made on that project, 3. Impact/Metrics of achievements, 4. Lessons learned from failures.';
        }

        let systemPrompt = `You are an expert AI interviewer conducting a ${session.interviewType} interview for a ${session.experienceLevel} ${session.role}.
Interview Blueprint/Structure:
${blueprint}

The candidate has completed ${session.usage.turns} out of ${MAX_TURNS} maximum turns.
Adapt your questions to follow this blueprint structure based on the current turn.
${resumeContext ? `Base some of your questions on the candidate's resume context provided above.` : ''}

Review the transcript of the interview so far:
${transcriptText}

Decide the next action. Choose "next_question" to move to the next topic in the blueprint, "follow_up" to probe deeper into their last answer, or "finish" if the interview should conclude.
Do NOT output any internal chain-of-thought or reasoning.`;

        let aiResponse;
        try {
            aiResponse = await aiClient.generateJsonWithRetry(systemPrompt, interviewResponseSchema, ['action']);
        } catch (aiErr) {
            console.error('AI Turn Error:', aiErr);
            // Safe fallback
            aiResponse = { action: 'next_question', question_text: "Let's move on. Could you share a project you're particularly proud of?" };
        }

        if (aiResponse.action === 'finish' || session.usage.turns >= MAX_TURNS - 1) {
            session.status = 'Completed';
            await session.save();
            return res.json({ action: 'finish', feedback: aiResponse.feedback_on_last_answer });
        }

        const newQuestion = aiResponse.question_text || "Could you tell me more about your experience?";
        
        session.transcript.push({
            turnId: session.usage.turns + 1,
            question: newQuestion,
            candidateAnswer: null
        });
        session.usage.turns += 1;
        await session.save();

        res.json({ action: aiResponse.action, question: newQuestion, feedback: aiResponse.feedback_on_last_answer, turns: session.usage.turns });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// Request Hint
router.post('/interview/session/:id/hint', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json({ error: 'Session not found' });
        }
        const session = await MockInterviewSession.findOne({ _id: req.params.id, candidate: req.user._id });
        if (!session || session.status !== 'In Progress' || session.transcript.length === 0) {
            return res.status(400).json({ error: 'Invalid session state for hint' });
        }

        if (session.usage.hints >= MAX_HINTS) {
            return res.status(403).json({ error: 'Maximum hints reached' });
        }

        const currentQuestion = session.transcript[session.transcript.length - 1].question;
        const prompt = `You are an AI interviewer. The candidate is stuck on this question: "${currentQuestion}". 
Provide a brief, encouraging hint to help them structure their answer. Do NOT give away the direct answer.`;

        let aiResponse;
        try {
            aiResponse = await aiClient.generateJsonWithRetry(prompt, hintResponseSchema, ['hint_text']);
        } catch (aiErr) {
            return res.status(500).json({ error: 'Failed to generate hint. Please try answering as best as you can.' });
        }

        session.usage.hints += 1;
        session.transcript[session.transcript.length - 1].hintUsed = true;
        await session.save();

        res.json({ hint: aiResponse.hint_text });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// Reframe Question
router.post('/interview/session/:id/reframe', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json({ error: 'Session not found' });
        }
        const session = await MockInterviewSession.findOne({ _id: req.params.id, candidate: req.user._id });
        if (!session || session.status !== 'In Progress' || session.transcript.length === 0) {
            return res.status(400).json({ error: 'Invalid session state for reframe' });
        }

        if (session.usage.reframes >= MAX_REFRAMES) {
            return res.status(403).json({ error: 'Maximum reframes reached' });
        }

        const currentQuestion = session.transcript[session.transcript.length - 1].question;
        const prompt = `You are an AI interviewer. Reframe the following question to make it clearer and easier to understand, without changing the underlying topic: "${currentQuestion}"`;

        let aiResponse;
        try {
            aiResponse = await aiClient.generateJsonWithRetry(prompt, reframeResponseSchema, ['reframed_question']);
        } catch (aiErr) {
            return res.status(500).json({ error: 'Failed to reframe question.' });
        }

        session.usage.reframes += 1;
        session.transcript[session.transcript.length - 1].reframed = true;
        session.transcript[session.transcript.length - 1].question = aiResponse.reframed_question; // Update question in place
        await session.save();

        res.json({ reframed_question: aiResponse.reframed_question });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// Complete & Generate Report
router.post('/interview/session/:id/complete', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json({ error: 'Session not found' });
        }
        const session = await MockInterviewSession.findOne({ _id: req.params.id, candidate: req.user._id });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        
        session.status = 'Completed';
        
        // Build dynamic schema based on interview type
        let dimensionKeys = [];
        if (session.interviewType === 'Technical') dimensionKeys = ['codeQuality', 'problemSolving', 'optimization'];
        else if (session.interviewType === 'Behavioral') dimensionKeys = ['starStructuring', 'leadership', 'conflictResolution'];
        else if (session.interviewType === 'System Design') dimensionKeys = ['scalability', 'faultTolerance', 'architecture'];
        else dimensionKeys = ['experienceDepth', 'impactArticulation', 'authenticity'];

        const dynamicEvalSchema = { 
            ...evaluationResponseSchema,
            properties: { ...evaluationResponseSchema.properties },
            required: [...evaluationResponseSchema.required]
        };
        dynamicEvalSchema.properties.dimensionScores = {
            type: "OBJECT",
            properties: {}
        };
        dimensionKeys.forEach(key => {
            dynamicEvalSchema.properties.dimensionScores.properties[key] = { type: "INTEGER", description: `Score from 0 to 100 for ${key}` };
        });
        dynamicEvalSchema.required.push("dimensionScores");

        let transcriptText = session.transcript.map((t, i) => `Q: ${t.question}\nA: ${t.candidateAnswer || '[No Answer]'}`).join('\n\n');
        
        const prompt = `Evaluate the following ${session.interviewType} mock interview transcript for a ${session.experienceLevel} ${session.role}.
Score the candidate on a scale of 0-100 overall, and provide scores (0-100) for the following dimensions: ${dimensionKeys.join(', ')}.
Provide a list of strengths, areas for improvement, and a summary feedback paragraph.

Transcript:
${transcriptText}`;

        // Ensure numeric types
        aiResponse.overallScore = Number(aiResponse.overallScore) || 0;
        Object.keys(aiResponse.dimensionScores || {}).forEach(k=>{
            aiResponse.dimensionScores[k] = Number(aiResponse.dimensionScores[k]) || 0;
        });

        session.evaluation = {
            overallScore: aiResponse.overallScore,
            strengths: aiResponse.strengths,
            improvements: aiResponse.improvements,
            feedback: aiResponse.feedback,
            dimensionScores: aiResponse.dimensionScores
        };

        await session.save();
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

router.get('/interview/session/:id/report', isAuthenticated, authorize('candidate'), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).send('Report not available');
        }
        const session = await MockInterviewSession.findOne({ _id: req.params.id, candidate: req.user._id });
        if (!session || session.status !== 'Completed') return res.status(404).send('Report not available');
        
        res.render('interview/report', { session, pageTitle: 'Interview Report' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
