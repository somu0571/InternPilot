// Utility to analyze resume quality using Gemini AI (stub implementation)
// In production this would call the Gemini API and return structured feedback.

const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialise the Gemini client – expects GEMINI_API_KEY env var.
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * Analyze the given resume text and return feedback.
 * @param {string} resumeText Plain text extracted from the PDF/DOCX.
 * @returns {Promise<object>} Feedback object with score, strengths, improvements.
 */
async function analyzeResumeQuality(resumeText) {
  if (!resumeText) {
    throw new Error('No resume text provided');
  }

  // Simple fallback when API key is missing – return mock data.
  if (!process.env.GEMINI_API_KEY) {
    return {
      score: 75,
      strengths: ['Clear formatting', 'Relevant technical keywords'],
      improvements: ['Add quantifiable achievements', 'Include project impact metrics'],
      summary: 'Your resume is well‑structured but could benefit from more measurable results.'
    };
  }

  // Real implementation using Gemini (placeholder prompt).
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const prompt = `You are an expert recruiter. Analyze the following resume text and provide:
- An overall score out of 100.
- 3 strengths.
- 3 concrete improvements.
- A concise summary.
Resume Text:\n${resumeText}`;

  const result = await model.generateContent(prompt);
  const response = await result.response;
  // Assuming the model returns JSON; try to parse.
  try {
    return JSON.parse(response.text());
  } catch (_) {
    // Fallback to raw text.
    return { raw: response.text() };
  }
}

module.exports = { analyzeResumeQuality };
