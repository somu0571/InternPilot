const { GoogleGenAI } = require('@google/genai');
const Internship = require('../models/Internship');
const Application = require('../models/Application');
const Recommendation = require('../models/Recommendation');
const { calculatePreFilterScore } = require('./candidateMatcher');
const { buildSkillProfiles } = require('./skillProfiles');

function getAiClient() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    return new GoogleGenAI({ apiKey });
}

const POOL_SIZE = parseInt(process.env.RECOMMENDATION_AI_POOL_SIZE, 10) || 25;


async function generateRecommendationsForUser(user) {
    try {
        
        const apps = await Application.find({ candidate: user._id }).select('internship');
        const appliedIds = apps.map(a => a.internship ? a.internship.toString() : null).filter(Boolean);

        
        const activeDeadlineCondition = {
            $or: [
                { applicationDeadline: { $exists: false } },
                { applicationDeadline: null },
                { applicationDeadline: { $gt: new Date() } }
            ]
        };

        let allEligible = await Internship.find({
            status: { $nin: ['draft', 'paused'] },
            isPaused: { $ne: true },
            _id: { $nin: appliedIds },
            ...activeDeadlineCondition
        }).lean();

        
        if (allEligible.length === 0) {
            allEligible = await Internship.find({
                status: { $nin: ['draft', 'paused'] },
                isPaused: { $ne: true },
                _id: { $nin: appliedIds }
            }).lean();
        }

        if (allEligible.length === 0) {
            await Recommendation.deleteMany({ candidate: user._id });
            return []; 
        }

        
        const scoredInternships = allEligible.map(internship => ({
            internship,
            preFilterScore: calculatePreFilterScore(user, internship)
        }));

        scoredInternships.sort((a, b) => b.preFilterScore - a.preFilterScore);
        const pool = scoredInternships.slice(0, POOL_SIZE);

        
        const candidateProfile = {
            skillProfiles: buildSkillProfiles(user),
            education: user.education || {},
            location: user.location || {}
        };

        const internshipsPayload = pool.map(item => ({
            id: item.internship._id.toString(),
            title: item.internship.title,
            company: item.internship.companyName,
            sector: item.internship.sector,
            skillsRequired: item.internship.requiredSkills || [],
            qualifications: item.internship.minQualifications || '',
            location: item.internship.location || {}
        }));

        const generatedAt = new Date();
        let aiResults = [];
        let isFallback = false;

        
        try {
            const prompt = `
You are an expert AI recruiter. Evaluate this candidate against a list of internships.
For each internship, calculate a semantic match score (0-100), explain the reasoning in one sentence, and provide a one-sentence skill gap analysis detailing what the candidate is missing.

Candidate Profile:
${JSON.stringify(candidateProfile, null, 2)}

Internships to Evaluate:
${JSON.stringify(internshipsPayload, null, 2)}
`;
            
            const client = getAiClient();
            if (!client) {
                throw new Error('GEMINI_API_KEY is not configured in environment variables.');
            }

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
            let lastAiErr = null;

            for (const model of modelsToTry) {
                try {
                    const response = await client.models.generateContent({
                        model,
                        contents: [{ role: 'user', parts: [{ text: prompt }] }],
                        config: {
                            responseMimeType: "application/json",
                            responseSchema: {
                                type: "ARRAY",
                                items: {
                                    type: "OBJECT",
                                    properties: {
                                        id: { type: "STRING" },
                                        aiMatchScore: { type: "INTEGER" },
                                        matchReasoning: { type: "STRING" },
                                        skillGapAnalysis: { type: "STRING" }
                                    },
                                    required: ["id", "aiMatchScore", "matchReasoning", "skillGapAnalysis"]
                                }
                            }
                        }
                    });

                    if (response && response.text) {
                        const parsed = JSON.parse(response.text);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            aiResults = parsed;
                            break;
                        }
                    }
                } catch (err) {
                    lastAiErr = err;
                    console.warn(`[RecommendationEngine] Model ${model} failed (${err.message || err}). Trying fallback model...`);
                }
            }

            if (!Array.isArray(aiResults) || aiResults.length === 0) {
                throw lastAiErr || new Error("All Gemini models failed or returned empty results.");
            }
        } catch (aiError) {
            
            console.error('Gemini Recommendation Error:', aiError.message || aiError);
            isFallback = true;
            
            
            aiResults = pool.map(item => ({
                id: item.internship._id.toString(),
                aiMatchScore: item.preFilterScore,
                matchReasoning: 'Based on keyword and location matching, this internship aligns with your profile.',
                skillGapAnalysis: 'AI skill gap analysis unavailable at this time.'
            }));
        }

        
        const newRecommendations = [];
        for (const item of pool) {
            const aiData = aiResults.find(r => r.id === item.internship._id.toString());
            if (aiData) {
                newRecommendations.push({
                    candidate: user._id,
                    internship: item.internship._id,
                    aiMatchScore: Math.min(Math.max(Number(aiData.aiMatchScore) || 0, 0), 100),
                    matchReasoning: aiData.matchReasoning || 'Good semantic match.',
                    skillGapAnalysis: aiData.skillGapAnalysis || 'No major gaps found.',
                    isFallback,
                    generatedAt
                });
            }
        }

        
        await Recommendation.deleteMany({ candidate: user._id });
        
        if (newRecommendations.length > 0) {
            
            newRecommendations.sort((a, b) => b.aiMatchScore - a.aiMatchScore);
            await Recommendation.insertMany(newRecommendations);
        }

        return newRecommendations;
    } catch (systemError) {
        
        console.error('System error during recommendation generation:', systemError);
        throw systemError;
    }
}

module.exports = {
    generateRecommendationsForUser
};
