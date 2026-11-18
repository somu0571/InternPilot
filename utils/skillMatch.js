const {
    buildSkillProfiles,
    skillKey,
    proficiencyWeight
} = require('./skillProfiles');

const clean = (skills) => (Array.isArray(skills) ? skills : []).filter(Boolean);


function calculateSkillScore(userOrSkills = [], requiredSkills = [], suppliedProfiles) {
    const required = clean(requiredSkills);
    if (!required.length) return 100;

    const profilesBySkill = new Map(
        buildSkillProfiles(userOrSkills, suppliedProfiles)
            .map(profile => [skillKey(profile.name), profile])
    );
    if (!profilesBySkill.size) return 0;

    const weightedMatches = required.reduce((total, skill) => {
        const profile = profilesBySkill.get(skillKey(skill));
        return total + (profile ? proficiencyWeight(profile.proficiency) : 0);
    }, 0);

    return Math.round((weightedMatches / required.length) * 100);
}

function findPartialMatch(requiredSkill, profiles) {
    const required = skillKey(requiredSkill);
    if (required.length < 3) return null;

    return profiles.find(profile => {
        const candidate = skillKey(profile.name);
        if (candidate.length < 3 || candidate === required) return false;
        return candidate.includes(required) || required.includes(candidate);
    }) || null;
}

function buildSummary({ hasProfileSkills, totalRequired, matchCount, missing, partial, developing }) {
    if (!totalRequired) {
        return 'This internship has not listed any required skills yet, so there is nothing to compare against.';
    }
    if (!hasProfileSkills) {
        return 'Add the skills you already have to your profile to see how well you fit this role.';
    }

    const base = `You fully meet ${matchCount} of ${totalRequired} required skills.`;
    const developingText = developing.length
        ? ` You are still developing: ${developing.map(item => item.required).join(', ')}.`
        : '';

    if (missing.length) {
        return `${base}${developingText} Consider learning: ${missing.join(', ')}.`;
    }
    if (partial.length) {
        const names = partial.map(item => item.required);
        return `${base}${developingText} Close but worth confirming: ${names.join(', ')}.`;
    }
    if (developing.length) return `${base}${developingText}`;
    return `${base} Your profile covers everything this role asks for.`;
}


function analyzeSkillGap(userOrSkills = [], requiredSkills = [], suppliedProfiles) {
    const profiles = buildSkillProfiles(userOrSkills, suppliedProfiles);
    const required = clean(requiredSkills);
    const profilesBySkill = new Map(profiles.map(profile => [skillKey(profile.name), profile]));

    const matched = [];
    const matchedSkillProfiles = [];
    const developing = [];
    const partial = [];
    const missing = [];

    required.forEach(skill => {
        const profile = profilesBySkill.get(skillKey(skill));
        if (profile) {
            const detail = {
                required: skill,
                profileSkill: profile.name,
                proficiency: profile.proficiency,
                weight: proficiencyWeight(profile.proficiency)
            };
            if (profile.proficiency === 'Beginner') {
                developing.push(detail);
            } else {
                matched.push(skill);
                matchedSkillProfiles.push(detail);
            }
            return;
        }

        const near = findPartialMatch(skill, profiles);
        if (near) {
            partial.push({
                required: skill,
                profileSkill: near.name,
                proficiency: near.proficiency
            });
            return;
        }

        missing.push(skill);
    });

    const hasProfileSkills = profiles.length > 0;
    const totalRequired = required.length;
    const matchCount = matched.length;

    return {
        hasProfileSkills,
        hasRequiredSkills: totalRequired > 0,
        totalRequired,
        matchCount,
        matched,
        matchedSkillProfiles,
        developing,
        partial,
        missing,
        score: calculateSkillScore(profiles, required),
        summary: buildSummary({ hasProfileSkills, totalRequired, matchCount, missing, partial, developing })
    };
}

module.exports = { calculateSkillScore, analyzeSkillGap };
