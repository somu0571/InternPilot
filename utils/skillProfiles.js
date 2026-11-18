const PROFICIENCY_LEVELS = Object.freeze(['Beginner', 'Intermediate', 'Advanced']);
const DEFAULT_PROFICIENCY = 'Intermediate';



const PROFICIENCY_WEIGHTS = Object.freeze({
    Beginner: 0.6,
    Intermediate: 0.8,
    Advanced: 1
});

function asArray(value) {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
}

function normaliseSkillName(value) {
    const raw = value && typeof value === 'object'
        ? (value.name || value.skill || '')
        : value;
    return String(raw || '').trim();
}

function skillKey(value) {
    return normaliseSkillName(value).toLowerCase();
}

function normalizeProficiency(value) {
    const matched = PROFICIENCY_LEVELS.find(level => level.toLowerCase() === String(value || '').trim().toLowerCase());
    return matched || DEFAULT_PROFICIENCY;
}

function proficiencyRank(value) {
    return PROFICIENCY_LEVELS.indexOf(normalizeProficiency(value));
}

function proficiencyWeight(value) {
    return PROFICIENCY_WEIGHTS[normalizeProficiency(value)];
}

function splitLegacySkills(values) {
    return asArray(values).flatMap(value => {
        if (typeof value === 'string') return value.split(',');
        return [value];
    });
}


function buildSkillProfiles(userOrSkills = [], suppliedProfiles) {
    const isUserLike = userOrSkills && typeof userOrSkills === 'object' && !Array.isArray(userOrSkills);
    const legacySkills = isUserLike ? userOrSkills.skills : userOrSkills;
    const storedProfiles = isUserLike
        ? userOrSkills.skillProfiles
        : suppliedProfiles;

    const detailsByKey = new Map();
    const detailOrder = [];

    for (const profile of asArray(storedProfiles)) {
        const name = normaliseSkillName(profile);
        const key = skillKey(name);
        if (!key) continue;

        const candidate = {
            name,
            proficiency: normalizeProficiency(profile?.proficiency)
        };
        const existing = detailsByKey.get(key);

        if (!existing) {
            detailsByKey.set(key, candidate);
            detailOrder.push(key);
        } else if (proficiencyRank(candidate.proficiency) > proficiencyRank(existing.proficiency)) {
            
            
            detailsByKey.set(key, { ...existing, proficiency: candidate.proficiency });
        }
    }

    const results = [];
    const included = new Set();
    const add = (rawSkill, fallbackProfile) => {
        const rawName = normaliseSkillName(rawSkill);
        const key = skillKey(rawName);
        if (!key || included.has(key)) return;

        const stored = detailsByKey.get(key);
        const inlineLevel = rawSkill && typeof rawSkill === 'object' ? rawSkill.proficiency : undefined;
        const chosen = stored || fallbackProfile || { name: rawName, proficiency: inlineLevel };
        results.push({
            name: normaliseSkillName(chosen.name) || rawName,
            proficiency: normalizeProficiency(chosen.proficiency || inlineLevel)
        });
        included.add(key);
    };

    for (const skill of splitLegacySkills(legacySkills)) add(skill);
    for (const key of detailOrder) add(detailsByKey.get(key), detailsByKey.get(key));

    return results;
}

function skillNames(userOrSkills = [], suppliedProfiles) {
    return buildSkillProfiles(userOrSkills, suppliedProfiles).map(profile => profile.name);
}

function findSkillProfile(userOrSkills, skill, suppliedProfiles) {
    const wanted = skillKey(skill);
    return buildSkillProfiles(userOrSkills, suppliedProfiles)
        .find(profile => skillKey(profile.name) === wanted) || null;
}


function parseSkillProfiles(body = {}) {
    const names = asArray(body.skillName || body.skillNames);
    const levels = asArray(body.skillProficiency || body.skillProficiencies);

    if (names.length) {
        const supplied = names.map((name, index) => ({
            name,
            proficiency: levels[index] || DEFAULT_PROFICIENCY
        }));
        
        
        
        return buildSkillProfiles(supplied, supplied);
    }

    return buildSkillProfiles(splitLegacySkills(body.skills));
}

function mergeSkillProfiles(existingUserOrSkills, incomingSkills = [], suppliedProfiles) {
    const existing = buildSkillProfiles(existingUserOrSkills, suppliedProfiles);
    const incoming = buildSkillProfiles(incomingSkills);
    return buildSkillProfiles(
        [...existing.map(profile => profile.name), ...incoming.map(profile => profile.name)],
        [...existing, ...incoming]
    );
}

module.exports = {
    PROFICIENCY_LEVELS,
    DEFAULT_PROFICIENCY,
    PROFICIENCY_WEIGHTS,
    normaliseSkillName,
    skillKey,
    normalizeProficiency,
    proficiencyRank,
    proficiencyWeight,
    buildSkillProfiles,
    skillNames,
    findSkillProfile,
    parseSkillProfiles,
    mergeSkillProfiles
};
