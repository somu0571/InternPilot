const { GoogleGenAI } = require('@google/genai');

/**
 * Shared AI Client for Issue #146 (Mock Interview & Problem Generator)
 * Provides schema validation and a 1-attempt repair/retry mechanism.
 */

/** Async sleep for exponential backoff between retries. */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Backoff delays per attempt number (ms). attempt 1 → 0ms, 2 → 500ms, 3 → 1500ms. */
const BACKOFF_MS = [0, 0, 500, 1500];

class AIClient {
    constructor() {
        this.apiKey = process.env.GEMINI_API_KEY;
        if (this.apiKey) {
            this.client = new GoogleGenAI({ apiKey: this.apiKey });
        }
        this.defaultModel = 'gemini-2.5-flash';
        this.fallbackModel = 'gemini-2.0-flash';
    }

    getClient() {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return null;
        }
        if (!this.client || this.apiKey !== apiKey) {
            this.apiKey = apiKey;
            this.client = new GoogleGenAI({ apiKey });
        }
        return this.client;
    }

    isTransientError(err) {
        return err && (err.status === 503 || (err.message && /high demand|temporar|503|overloaded/i.test(err.message)));
    }

    /**
     * Generates structured JSON adhering to the provided responseSchema.
     * Includes exactly 1 repair/retry attempt if parsing fails or fields are missing.
     * Transient errors (503) use exponential backoff before retrying.
     */
    async generateJsonWithRetry(prompt, responseSchema, requiredFields = [], attempt = 1, previousError = null) {
        const client = this.getClient();
        if (!client) {
            throw new Error('GEMINI_API_KEY is not configured in environment variables.');
        }

        let modelToUse = process.env.GEMINI_MODEL;
        if (modelToUse && (modelToUse.includes('3.8') || modelToUse.includes('3.5'))) {
            modelToUse = null;
        }
        modelToUse = modelToUse || this.defaultModel;

        let fallbackModel = process.env.GEMINI_FALLBACK_MODEL;
        if (fallbackModel && (fallbackModel.includes('3.8') || fallbackModel.includes('3.5'))) {
            fallbackModel = null;
        }
        fallbackModel = fallbackModel || this.fallbackModel;

        let finalPrompt = prompt;
        if (attempt > 1 && previousError) {
            finalPrompt = `${prompt}\n\nIMPORTANT: Your previous response was invalid. Error: ${previousError}. Please ensure you return valid JSON matching the exact schema.`;
        }

        // Exponential backoff: wait before retry attempts.
        const delay = BACKOFF_MS[attempt] || 0;
        if (delay > 0) {
            await sleep(delay);
        }

        try {
            const response = await client.models.generateContent({
                model: modelToUse,
                contents: [{ role: 'user', parts: [{ text: finalPrompt }] }],
                config: {
                    responseMimeType: "application/json",
                    responseSchema: responseSchema
                }
            });

            const parsed = JSON.parse(response.text);

            // Strict Validation
            if (requiredFields.length > 0) {
                for (const field of requiredFields) {
                    if (parsed[field] === undefined || parsed[field] === null || parsed[field] === '') {
                        throw new Error(`Missing required field: ${field}`);
                    }
                }
            }

            return parsed;

        } catch (err) {
            // Handle 503 Fallback natively on attempt 1
            if (attempt === 1 && this.isTransientError(err)) {
                console.warn(`[AIClient] ${modelToUse} is experiencing high demand. Failing over to ${fallbackModel} after backoff...`);
                try {
                    await sleep(BACKOFF_MS[2] || 500);
                    const fallbackResponse = await client.models.generateContent({
                        model: fallbackModel,
                        contents: [{ role: 'user', parts: [{ text: prompt }] }],
                        config: {
                            responseMimeType: "application/json",
                            responseSchema: responseSchema
                        }
                    });
                    const parsedFallback = JSON.parse(fallbackResponse.text);
                    for (const field of requiredFields) {
                        if (parsedFallback[field] === undefined || parsedFallback[field] === null || parsedFallback[field] === '') {
                            throw new Error(`Missing required field: ${field}`);
                        }
                    }
                    return parsedFallback;
                } catch (fallbackErr) {
                    // If fallback also fails structurally, do the 1 retry
                    if (fallbackErr.name === 'SyntaxError' || (fallbackErr.message && fallbackErr.message.includes('Missing required field'))) {
                        return this.generateJsonWithRetry(prompt, responseSchema, requiredFields, 2, fallbackErr.message);
                    }
                    throw fallbackErr;
                }
            }

            // Repair/Retry for validation or parse errors
            if (attempt === 1 && (err.name === 'SyntaxError' || (err.message && err.message.includes('Missing required field')))) {
                console.warn(`[AIClient] Validation failed, triggering repair retry after backoff. Error: ${err.message}`);
                return this.generateJsonWithRetry(prompt, responseSchema, requiredFields, 2, err.message);
            }

            throw err;
        }
    }
}

module.exports = new AIClient();

