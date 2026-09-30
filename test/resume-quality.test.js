const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const userRouter = require('../routes/user');
const analyzeResumeQuality = userRouter.analyzeResumeQuality;

function renderCandidateProfile(candidateData = {}) {
    const templatePath = path.join(__dirname, '..', 'views', 'candidate', 'candidate-profile.ejs');
    const rawTemplate = fs.readFileSync(templatePath, 'utf8')
        .replace("<% layout('layouts/boilerplate') %>", '');

    const candidate = {
        name: 'Rahul Sharma',
        age: 22,
        familyIncome: 420000,
        education: { qualification: 'B.Tech', institutionName: 'Pune University' },
        enrollmentStatus: 'not_enrolled',
        employmentStatus: 'unemployed',
        location: { district: 'Pune', state: 'Maharashtra' },
        skills: ['JavaScript', 'React'],
        resume: 'https://res.cloudinary.com/demo/raw/upload/internpilot/resumes/12345_sample.pdf',
        resumeOriginalName: 'sample_resume.pdf',
        resumeUploadedAt: new Date('2026-09-20T10:00:00Z'),
        ...candidateData
    };

    return ejs.render(rawTemplate, {
        candidate,
        user: candidate,
        activeUser: candidate,
        currentUser: candidate,
        eligibility: {
            status: 'eligible',
            badge: { label: 'Eligible', bgClass: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: 'ph-check-circle' },
            reasons: [],
            missingFields: [],
            criteria: []
        },
        pmisRules: {},
        skillProfiles: [{ name: 'JavaScript', proficiency: 'Intermediate' }],
        success_msg: null,
        error_msg: null,
        showConflictModal: false
    });
}

test('analyzeResumeQuality uses process.env.GEMINI_MODEL when configured', async () => {
    const originalEnvModel = process.env.GEMINI_MODEL;
    process.env.GEMINI_MODEL = 'custom-gemini-v3';

    let capturedOptions = null;
    const mockClient = {
        models: {
            generateContent: async (options) => {
                capturedOptions = options;
                return {
                    text: JSON.stringify({
                        quantifiableAchievements: { status: 'good', feedback: 'Increased efficiency by 30%.' },
                        technicalSkills: { status: 'good', feedback: 'Solid JavaScript experience.' },
                        projects: { status: 'good', feedback: 'Developed full stack applications.' },
                        overallFeedback: 'Well structured resume.'
                    })
                };
            }
        }
    };

    try {
        const result = await analyzeResumeQuality('Candidate CV with metrics and React experience', mockClient);
        assert.equal(capturedOptions.model, 'custom-gemini-v3');
        assert.equal(capturedOptions.config?.responseMimeType, 'application/json');
        assert.equal(result.quantifiableAchievements.status, 'good');
        assert.match(result.quantifiableAchievements.feedback, /30%/);
    } finally {
        if (originalEnvModel !== undefined) {
            process.env.GEMINI_MODEL = originalEnvModel;
        } else {
            delete process.env.GEMINI_MODEL;
        }
    }
});

test('analyzeResumeQuality defaults to gemini-2.5-flash when GEMINI_MODEL is not set', async () => {
    const originalEnvModel = process.env.GEMINI_MODEL;
    delete process.env.GEMINI_MODEL;

    let capturedOptions = null;
    const mockClient = {
        models: {
            generateContent: async (options) => {
                capturedOptions = options;
                return {
                    text: JSON.stringify({
                        quantifiableAchievements: { status: 'good', feedback: 'Strong achievements.' },
                        technicalSkills: { status: 'good', feedback: 'Strong skills.' },
                        projects: { status: 'good', feedback: 'Impressive projects.' },
                        overallFeedback: 'Overall great profile.'
                    })
                };
            }
        }
    };

    try {
        const result = await analyzeResumeQuality('Candidate CV text', mockClient);
        assert.equal(capturedOptions.model, 'gemini-2.5-flash');
        assert.equal(capturedOptions.config?.responseMimeType, 'application/json');
        assert.equal(result.overallFeedback, 'Overall great profile.');
    } finally {
        if (originalEnvModel !== undefined) {
            process.env.GEMINI_MODEL = originalEnvModel;
        }
    }
});

test('analyzeResumeQuality successfully strips markdown backticks from AI output', async () => {
    const markdownWrappedJson = `\`\`\`json
{
  "quantifiableAchievements": {
    "status": "needs_improvement",
    "feedback": "Include measurable metrics such as revenue or user growth."
  },
  "technicalSkills": {
    "status": "good",
    "feedback": "Proficient in Python, Node.js, and Docker."
  },
  "projects": {
    "status": "good",
    "feedback": "Two relevant web development projects mentioned."
  },
  "overallFeedback": "Clear potential, needs more quantitative data."
}
\`\`\``;

    const mockClient = {
        models: {
            generateContent: async () => ({
                text: markdownWrappedJson
            })
        }
    };

    const result = await analyzeResumeQuality('Resume text with Python and Docker', mockClient);
    assert.equal(result.technicalSkills.status, 'good');
    assert.equal(result.technicalSkills.feedback, 'Proficient in Python, Node.js, and Docker.');
    assert.equal(result.quantifiableAchievements.status, 'needs_improvement');
    assert.match(result.quantifiableAchievements.feedback, /measurable metrics/);
});

test('analyzeResumeQuality handles API errors gracefully with fallback message and logs error', async () => {
    const originalConsoleError = console.error;
    let loggedError = null;
    console.error = (...args) => {
        loggedError = args.join(' ');
    };

    const mockClient = {
        models: {
            generateContent: async () => {
                const err = new Error('Model models/gemini-2.5-flash is no longer available. Status: 404');
                err.status = 404;
                throw err;
            }
        }
    };

    try {
        const result = await analyzeResumeQuality('Some resume text', mockClient);

        assert.ok(loggedError, 'Expected error to be logged to console.error');
        assert.match(loggedError, /Error analyzing resume quality with Gemini AI/);
        assert.match(loggedError, /404/);

        assert.equal(result.quantifiableAchievements.status, 'needs_improvement');
        assert.equal(result.quantifiableAchievements.feedback, 'Resume quality analysis was unavailable.');
        assert.equal(result.technicalSkills.status, 'needs_improvement');
        assert.equal(result.technicalSkills.feedback, 'Resume quality analysis was unavailable.');
        assert.equal(result.projects.status, 'needs_improvement');
        assert.equal(result.projects.feedback, 'Resume quality analysis was unavailable.');
        assert.equal(result.overallFeedback, 'Resume uploaded successfully, but AI quality feedback could not be generated.');
    } finally {
        console.error = originalConsoleError;
    }
});

test('analyzeResumeQuality returns early when resume text is empty or whitespace', async () => {
    let called = false;
    const mockClient = {
        models: {
            generateContent: async () => {
                called = true;
                return { text: '{}' };
            }
        }
    };

    const resultEmpty = await analyzeResumeQuality('', mockClient);
    const resultWhitespace = await analyzeResumeQuality('   \n  \t  ', mockClient);

    assert.equal(called, false, 'generateContent should not be called when text is empty');
    assert.equal(resultEmpty.quantifiableAchievements.feedback, 'Resume text could not be extracted.');
    assert.equal(resultWhitespace.overallFeedback, 'Resume uploaded successfully, but text could not be read for AI feedback.');
});

test('analyzeResumeQuality handles unconfigured GEMINI_API_KEY gracefully', async () => {
    const originalApiKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
        const result = await analyzeResumeQuality('Valid resume text', null);
        assert.equal(result.quantifiableAchievements.feedback, 'Resume quality analysis was unavailable.');
        assert.equal(result.overallFeedback, 'Resume uploaded successfully, but AI quality feedback could not be generated.');
    } finally {
        if (originalApiKey !== undefined) {
            process.env.GEMINI_API_KEY = originalApiKey;
        }
    }
});

test('analyzeResumeQuality fails over to gemini-2.0-flash when primary model encounters 503 high demand', async () => {
    let callCount = 0;
    const requestedModels = [];

    const mockClient = {
        models: {
            generateContent: async (options) => {
                callCount++;
                requestedModels.push(options.model);
                if (options.model !== 'gemini-2.0-flash') {
                    const err = new Error('This model is currently experiencing high demand. Spikes in demand are usually temporary.');
                    err.status = 503;
                    throw err;
                }
                return {
                    text: JSON.stringify({
                        quantifiableAchievements: { status: 'good', feedback: 'Great metrics.' },
                        technicalSkills: { status: 'good', feedback: 'Great skills.' },
                        projects: { status: 'good', feedback: 'Great projects.' },
                        overallFeedback: 'Failover successful.'
                    })
                };
            }
        }
    };

    const originalEnvModel = process.env.GEMINI_MODEL;
    delete process.env.GEMINI_MODEL;

    try {
        const result = await analyzeResumeQuality('Some resume text', mockClient);
        assert.equal(callCount, 2);
        assert.deepEqual(requestedModels, ['gemini-2.5-flash', 'gemini-2.0-flash']);
        assert.equal(result.overallFeedback, 'Failover successful.');
    } finally {
        if (originalEnvModel !== undefined) {
            process.env.GEMINI_MODEL = originalEnvModel;
        } else {
            delete process.env.GEMINI_MODEL;
        }
    }
});

test('candidate-profile.ejs renders active AI resume feedback and suggestions', () => {
    const html = renderCandidateProfile({
        resumeQuality: {
            quantifiableAchievements: {
                status: 'good',
                feedback: 'Demonstrated quantifiable impact by speeding up API queries by 45%.'
            },
            technicalSkills: {
                status: 'good',
                feedback: 'Strong proficiency in TypeScript, React, and MongoDB.'
            },
            projects: {
                status: 'needs_improvement',
                feedback: 'Consider expanding on deployment methodologies and CI/CD pipelines.'
            },
            overallFeedback: 'Strong technical profile with excellent real-world impact.'
        }
    });

    assert.match(html, /Resume Quality Feedback/);
    assert.match(html, /AI Analyzed/);
    assert.match(html, /Quantifiable Achievements/);
    assert.match(html, /speeding up API queries by 45%/);
    assert.match(html, /Technical Skills/);
    assert.match(html, /TypeScript, React, and MongoDB/);
    assert.match(html, /Projects/);
    assert.match(html, /deployment methodologies/);
    assert.match(html, /Overall Feedback/);
    assert.match(html, /Strong technical profile with excellent real-world impact/);
});
