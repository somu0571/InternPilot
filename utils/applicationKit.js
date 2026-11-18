const { sanitizeHttpUrl } = require('./safeUrl');

const MAX_APPLICATION_QUESTIONS = 10;
const MAX_QUESTION_LENGTH = 500;
const MAX_ANSWER_LENGTH = 2000;
const MAX_SELECTED_ITEMS = 20;

class ApplicationKitValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ApplicationKitValidationError';
        this.statusCode = 400;
    }
}

function asArray(value) {
    if (value === undefined || value === null || value === '') return [];
    return Array.isArray(value) ? value : [value];
}

function idOf(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'object' && value._id !== undefined) return String(value._id);
    return String(value);
}

function cleanText(value, maxLength) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}




function safeStoredFileUrl(value) {
    const raw = cleanText(value, 2000);
    if (!raw) return '';
    if (/^\/uploads\/(?:resumes|documents)\
    return sanitizeHttpUrl(raw).url;
}

function toBoolean(value) {
    return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

function uniqueStrings(values, limit = MAX_SELECTED_ITEMS) {
    const unique = [];
    const seen = new Set();

    for (const value of asArray(values)) {
        const normalized = cleanText(String(value || ''), 160);
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(normalized);
        }
        if (unique.length >= limit) break;
    }

    return unique;
}

function parseJsonArray(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed.startsWith('[')) return null;

    try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : null;
    } catch (_) {
        return null;
    }
}


function parseApplicationQuestions(body = {}) {
    const rawQuestions = body.applicationQuestions !== undefined
        ? body.applicationQuestions
        : body.applicationQuestion;
    const jsonQuestions = parseJsonArray(rawQuestions);
    const questions = jsonQuestions || asArray(rawQuestions);
    const requiredIndexes = new Set(
        asArray(body.requiredQuestionIndexes !== undefined
            ? body.requiredQuestionIndexes
            : body.applicationQuestionRequired)
            .map(value => String(value))
    );

    if (questions.length > MAX_APPLICATION_QUESTIONS) {
        throw new ApplicationKitValidationError(`A listing can include up to ${MAX_APPLICATION_QUESTIONS} application questions.`);
    }

    const normalized = [];
    questions.forEach((value, index) => {
        const prompt = cleanText(
            typeof value === 'object' && value !== null ? value.prompt : value,
            MAX_QUESTION_LENGTH
        );
        if (!prompt) return;

        const required = typeof value === 'object' && value !== null && value.required !== undefined
            ? toBoolean(value.required)
            : requiredIndexes.has(String(index));

        normalized.push({
            prompt,
            required,
            maxLength: MAX_ANSWER_LENGTH
        });
    });

    if (normalized.length > MAX_APPLICATION_QUESTIONS) {
        throw new ApplicationKitValidationError(`A listing can include up to ${MAX_APPLICATION_QUESTIONS} application questions.`);
    }

    return normalized;
}

function getApplicationQuestions(internship) {
    return asArray(internship && internship.applicationQuestions)
        .map((question, index) => {
            const prompt = cleanText(question && question.prompt, MAX_QUESTION_LENGTH);
            if (!prompt) return null;
            return {
                id: idOf(question),
                prompt,
                required: Boolean(question.required),
                maxLength: Number(question.maxLength) > 0
                    ? Math.min(Number(question.maxLength), MAX_ANSWER_LENGTH)
                    : MAX_ANSWER_LENGTH,
                order: index
            };
        })
        .filter(Boolean);
}

function getResumeVersions(candidate) {
    const versions = [];
    const seenUrls = new Set();

    asArray(candidate && candidate.resumeVersions).forEach(version => {
        const fileUrl = safeStoredFileUrl(version && (version.fileUrl || version.url));
        if (!fileUrl) return;
        seenUrls.add(fileUrl);
        versions.push({
            sourceId: idOf(version),
            label: cleanText(version && version.label, 100) || 'Resume version',
            fileUrl,
            fileName: cleanText(version && version.fileName, 180),
            isDefault: Boolean(version && version.isDefault)
        });
    });

    const legacyUrl = safeStoredFileUrl(candidate && candidate.resume);
    if (legacyUrl && !seenUrls.has(legacyUrl)) {
        versions.unshift({
            sourceId: 'legacy',
            label: 'Current resume',
            fileUrl: legacyUrl,
            fileName: '',
            isDefault: versions.length === 0
        });
    }

    return versions;
}

function getCandidateSkills(candidate) {
    const skills = [];
    const seen = new Set();

    const addSkill = (name, proficiency = 'Intermediate') => {
        const cleanName = cleanText(name, 80);
        if (!cleanName || seen.has(cleanName.toLowerCase())) return;
        seen.add(cleanName.toLowerCase());
        skills.push({
            name: cleanName,
            proficiency: ['Beginner', 'Intermediate', 'Advanced'].includes(proficiency)
                ? proficiency
                : 'Intermediate'
        });
    };

    asArray(candidate && candidate.skillProfiles).forEach(skill => {
        addSkill(skill && skill.name, skill && skill.proficiency);
    });
    asArray(candidate && candidate.skills).forEach(skill => addSkill(skill));

    return skills;
}

function sourceItems(candidate, field) {
    return asArray(candidate && candidate[field]).map(item => ({
        sourceId: idOf(item),
        item
    })).filter(entry => entry.sourceId);
}

function selectedSourceItems(candidate, field, requestedIds) {
    const source = sourceItems(candidate, field);
    const requested = uniqueStrings(requestedIds, MAX_SELECTED_ITEMS);

    if (requested.length === 0) return [];
    const selected = [];
    for (const requestedId of requested) {
        const found = source.find(entry => entry.sourceId === requestedId);
        if (!found) {
            throw new ApplicationKitValidationError(`One of the selected ${field} entries is no longer available on your profile.`);
        }
        selected.push(found.item);
    }
    return selected;
}

function snapshotProject(project) {
    return {
        sourceId: idOf(project),
        title: cleanText(project && project.title, 120),
        description: cleanText(project && project.description, 1000),
        link: sanitizeHttpUrl(project && project.link).url,
        techStack: uniqueStrings(project && project.techStack, 20),
        fileUrl: safeStoredFileUrl(project && project.fileUrl),
        fileName: cleanText(project && project.fileName, 180)
    };
}

function snapshotCertification(certification) {
    const issueDate = certification && certification.issueDate
        ? new Date(certification.issueDate)
        : null;

    return {
        sourceId: idOf(certification),
        name: cleanText(certification && certification.name, 120),
        issuer: cleanText(certification && certification.issuer, 120),
        issueDate: issueDate && !Number.isNaN(issueDate.getTime()) ? issueDate : undefined,
        link: sanitizeHttpUrl(certification && certification.link).url,
        fileUrl: safeStoredFileUrl(certification && certification.fileUrl),
        fileName: cleanText(certification && certification.fileName, 180)
    };
}

function normalizedAnswerMap(rawAnswers) {
    if (!rawAnswers || typeof rawAnswers !== 'object' || Array.isArray(rawAnswers)) return {};
    return Object.entries(rawAnswers).reduce((answers, [id, answer]) => {
        answers[String(id)] = cleanText(answer, MAX_ANSWER_LENGTH);
        return answers;
    }, {});
}

function selectedSkills(candidate, requestedNames) {
    const available = getCandidateSkills(candidate);
    const requested = uniqueStrings(requestedNames, MAX_SELECTED_ITEMS);
    if (requested.length === 0) return [];

    return requested.map(requestedName => {
        const skill = available.find(item => item.name.toLowerCase() === requestedName.toLowerCase());
        if (!skill) {
            throw new ApplicationKitValidationError('One of the selected skills is no longer available on your profile.');
        }
        return { name: skill.name, proficiency: skill.proficiency };
    });
}

function candidateProfileSnapshot(candidate) {
    const location = candidate && candidate.location ? candidate.location : {};
    const education = candidate && candidate.education ? candidate.education : {};
    return {
        name: cleanText(candidate && candidate.name, 120),
        email: cleanText(candidate && candidate.email, 254).toLowerCase(),
        location: {
            district: cleanText(location.district, 120),
            state: cleanText(location.state, 120)
        },
        education: {
            qualification: cleanText(education.qualification, 120),
            institutionName: cleanText(education.institutionName || (candidate && candidate.institution), 180)
        }
    };
}

function chooseDefaultResume(resumeVersions) {
    return resumeVersions.find(version => version.isDefault) || resumeVersions[0] || null;
}


function buildApplicationKit({ candidate, internship, body = {}, useDefaults = false, submittedAt = new Date() }) {
    const questions = getApplicationQuestions(internship);
    const resumeVersions = getResumeVersions(candidate);
    const requestedResumeId = cleanText(body.resumeVersionId, 120);
    let resume = null;

    if (requestedResumeId) {
        resume = resumeVersions.find(version => version.sourceId === requestedResumeId);
        if (!resume) {
            throw new ApplicationKitValidationError('The selected resume version is no longer available on your profile.');
        }
    } else if (useDefaults) {
        resume = chooseDefaultResume(resumeVersions);
    }

    const projectIds = useDefaults
        ? sourceItems(candidate, 'projects').map(entry => entry.sourceId)
        : body.projectIds;
    const certificationIds = useDefaults
        ? sourceItems(candidate, 'certifications').map(entry => entry.sourceId)
        : body.certificationIds;
    const skillNames = useDefaults
        ? getCandidateSkills(candidate).map(skill => skill.name)
        : body.skillNames;

    const projects = selectedSourceItems(candidate, 'projects', projectIds).map(snapshotProject);
    const certifications = selectedSourceItems(candidate, 'certifications', certificationIds).map(snapshotCertification);
    const skills = selectedSkills(candidate, skillNames);
    const answerMap = normalizedAnswerMap(body.answers);
    const answers = questions.map(question => {
        const answer = cleanText(answerMap[question.id], question.maxLength);
        if (question.required && !answer) {
            throw new ApplicationKitValidationError(`Please answer the required question: ${question.prompt}`);
        }
        return {
            questionId: question.id,
            prompt: question.prompt,
            required: question.required,
            answer
        };
    });

    return {
        submittedAt,
        resume: resume ? {
            sourceId: resume.sourceId,
            label: resume.label,
            fileUrl: resume.fileUrl,
            fileName: resume.fileName
        } : undefined,
        projects,
        certifications,
        skills,
        answers,
        candidateProfile: candidateProfileSnapshot(candidate)
    };
}

function hasApplicationQuestions(internship) {
    return getApplicationQuestions(internship).length > 0;
}

module.exports = {
    ApplicationKitValidationError,
    MAX_APPLICATION_QUESTIONS,
    MAX_QUESTION_LENGTH,
    MAX_ANSWER_LENGTH,
    parseApplicationQuestions,
    getApplicationQuestions,
    getResumeVersions,
    getCandidateSkills,
    buildApplicationKit,
    hasApplicationQuestions,
    candidateProfileSnapshot
};
