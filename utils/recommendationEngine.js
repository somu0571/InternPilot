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

/**
 * Executes the multi-stage recommendation funnel for a candidate.
 */
async function generateRecommendationsForUser(user) {
    try {
        // 1. Fetch already applied internships
        const apps = await Application.find({ candidate: user._id }).select('internship');
        const appliedIds = apps.map(a => a.internship ? a.internship.toString() : null).filter(Boolean);

        // 2. Fetch all eligible active internships (exclude draft and paused)
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

        // If deadline filter eliminated all listings, fall back without deadline restriction
        if (allEligible.length === 0) {
            allEligible = await Internship.find({
                status: { $nin: ['draft', 'paused'] },
                isPaused: { $ne: true },
                _id: { $nin: appliedIds }
            }).lean();
        }

        if (allEligible.length === 0) {
            await Recommendation.deleteMany({ candidate: user._id });
            return []; // Nothing to recommend
        }

        // 3. Cheap Candidate Pre-filter
        const scoredInternships = allEligible.map(internship => ({
            internship,
            preFilterScore: calculatePreFilterScore(user, internship)
        }));

        scoredInternships.sort((a, b) => b.preFilterScore - a.preFilterScore);
        const pool = scoredInternships.slice(0, POOL_SIZE);

        // 4. Privacy Filter: Strip PII before sending to Gemini
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

        // 5. Gemini Semantic Scoring with multi-model fallback
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
            // Log the underlying AI failure server-side for diagnosis
            console.error('Gemini Recommendation Error:', aiError.message || aiError);
            isFallback = true;
            
            // Deterministic Fallback Data Contract
            aiResults = pool.map(item => ({
                id: item.internship._id.toString(),
                aiMatchScore: item.preFilterScore,
                matchReasoning: 'Based on keyword and location matching, this internship aligns with your profile.',
                skillGapAnalysis: 'AI skill gap analysis unavailable at this time.'
            }));
        }

        // 6. Build the bulk write operations to completely replace existing recommendations
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

        // Delete old recommendations for this candidate and insert the fresh generation
        await Recommendation.deleteMany({ candidate: user._id });
        
        if (newRecommendations.length > 0) {
            // Sort by AI score before saving so they are naturally retrieved in order
            newRecommendations.sort((a, b) => b.aiMatchScore - a.aiMatchScore);
            await Recommendation.insertMany(newRecommendations);
        }

        return newRecommendations;
    } catch (systemError) {
        // Do not catch database/system failures as if they were AI failures.
        console.error('System error during recommendation generation:', systemError);
        throw systemError;
    }
}

module.exports = {
    generateRecommendationsForUser
};
