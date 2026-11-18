const {
    buildSkillProfiles,
    skillKey,
    proficiencyWeight
} = require('./skillProfiles');

function normalize(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeList(values) {
    return (Array.isArray(values) ? values : [])
        .map(normalize)
        .filter(Boolean);
}

function calculateCandidateMatch(candidate = {}, internship = {}) {
    candidate = candidate || {};
    internship = internship || {};
    const requiredSkills = normalizeList(internship.requiredSkills);
    const candidateSkillProfiles = buildSkillProfiles(candidate);
    const candidateProfilesBySkill = new Map(
        candidateSkillProfiles.map(profile => [skillKey(profile.name), profile])
    );

    const matchingSkillProfiles = requiredSkills
        .map(skill => {
            const profile = candidateProfilesBySkill.get(skill);
            return profile
                ? {
                    skill,
                    profileSkill: profile.name,
                    proficiency: profile.proficiency,
                    weight: proficiencyWeight(profile.proficiency)
                }
                : null;
        })
        .filter(Boolean);
    const matchingSkills = matchingSkillProfiles.map(match => match.skill);

    
    
    
    const skillScore = requiredSkills.length === 0
        ? 35
        : Math.round((matchingSkillProfiles.reduce((total, match) => total + match.weight, 0) / requiredSkills.length) * 70);

    const candidateQualification = normalize(candidate.education?.qualification);
    const requiredQualification = normalize(internship.minQualifications);
    const qualificationMatches = !requiredQualification || requiredQualification === 'any'
        ? true
        : Boolean(candidateQualification) && (candidateQualification.includes(requiredQualification) || requiredQualification.includes(candidateQualification));
    const qualificationScore = requiredQualification && requiredQualification !== 'any'
        ? (qualificationMatches ? 15 : 0)
        : 15;

    const candidateDistrict = normalize(candidate.location?.district);
    const candidateState = normalize(candidate.location?.state);
    const internshipDistrict = normalize(internship.location?.district);
    const internshipState = normalize(internship.location?.state);
    const locationScore = candidateDistrict && internshipDistrict && candidateDistrict === internshipDistrict
        ? 15
        : candidateState && internshipState && candidateState === internshipState ? 8 : 0;

    const score = Math.min(skillScore + qualificationScore + locationScore, 100);
    const rationale = [];
    if (matchingSkills.length) {
        rationale.push(`Matching skills: ${matchingSkills.join(', ')}`);
        rationale.push(`Proficiency: ${matchingSkillProfiles.map(match => `${match.proficiency} ${match.profileSkill}`).join(', ')}`);
    }
    if (requiredSkills.length && !matchingSkills.length) rationale.push('No required skills matched yet');
    if (requiredQualification) rationale.push(qualificationMatches ? 'Qualification aligns' : 'Qualification needs review');
    if (locationScore) rationale.push(locationScore === 15 ? 'Same district' : 'Same state');
    if (!rationale.length) rationale.push('Limited profile data available');

    return {
        score,
        matchingSkills,
        matchingSkillProfiles,
        qualificationMatches,
        rationale: rationale.join('. ') + '.'
    };
}

function calculatePreFilterScore(candidate, internship) {
    return calculateCandidateMatch(candidate, internship).score;
}

module.exports = { calculateCandidateMatch, calculatePreFilterScore };
