


const { GoogleGenerativeAI } = require('@google/generative-ai');


const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');


async function analyzeResumeQuality(resumeText) {
  if (!resumeText) {
    throw new Error('No resume text provided');
  }

  
  if (!process.env.GEMINI_API_KEY) {
    return {
      score: 75,
      strengths: ['Clear formatting', 'Relevant technical keywords'],
      improvements: ['Add quantifiable achievements', 'Include project impact metrics'],
      summary: 'Your resume is well‑structured but could benefit from more measurable results.'
    };
  }

  
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const prompt = `You are an expert recruiter. Analyze the following resume text and provide:
- An overall score out of 100.
- 3 strengths.
- 3 concrete improvements.
- A concise summary.
Resume Text:\n${resumeText}`;

  const result = await model.generateContent(prompt);
  const response = await result.response;
  
  try {
    return JSON.parse(response.text());
  } catch (_) {
    
    return { raw: response.text() };
  }
}

module.exports = { analyzeResumeQuality };
