/**
 * Profile Completion Scoring Engine for InternPilot Candidates
 * 
 * Provides configurable weighted scoring, category classification (required vs recommended),
 * missing items checklist generation, and progress indicators to boost student engagement,
 * recruiter discovery, and AI matching accuracy.
 */

const DEFAULT_COMPLETION_RULES = [
    {
        id: 'contactInfo',
        label: 'Contact & Location',
        category: 'required',
        weight: 15,
        description: 'Provide your full name, email address, and current location.',
        actionTarget: 'openModalBtn',
        actionText: 'Update Location',
        actionType: 'modal',
        icon: 'ph-map-pin',
        check: (user = {}) => {
            const hasName = Boolean(user && user.name && user.name.trim());
            const hasEmail = Boolean(user && user.email && user.email.trim());
            let hasLocation = false;
            if (user && user.location) {
                if (typeof user.location === 'object') {
                    hasLocation = Boolean(
                        (user.location.district && user.location.district.trim()) ||
                        (user.location.state && user.location.state.trim())
                    );
                } else if (typeof user.location === 'string') {
                    hasLocation = Boolean(user.location.trim());
                }
            }

            const completed = hasName && hasEmail && hasLocation;
            let detail = 'Name, email & location provided';
            if (!hasLocation) {
                detail = 'Location not provided';
            } else if (!hasName || !hasEmail) {
                detail = 'Basic contact details missing';
            }

            return {
                completed,
                detail: completed ? (typeof user.location === 'object' ? [user.location.district, user.location.state].filter(Boolean).join(', ') : user.location) : detail
            };
        }
    },
    {
        id: 'education',
        label: 'Education Details',
        category: 'required',
        weight: 20,
        description: 'Specify your highest qualification and university or college.',
        actionTarget: 'openModalBtn',
        actionText: 'Add Education',
        actionType: 'modal',
        icon: 'ph-graduation-cap',
        check: (user = {}) => {
            const qualification = (
                (user && user.education && user.education.qualification) ||
                (user && user.qualification) ||
                ''
            ).toString().trim();

            const institution = (
                (user && user.education && user.education.institutionName) ||
                (user && user.institution) ||
                ''
            ).toString().trim();

            const hasQual = Boolean(qualification);
            const hasInst = Boolean(institution);
            const completed = hasQual && hasInst;

            let detail = 'Qualification and college provided';
            if (hasQual && hasInst) {
                detail = `${qualification} • ${institution}`;
            } else if (hasQual && !hasInst) {
                detail = `${qualification} (College missing)`;
            } else if (!hasQual && hasInst) {
                detail = `College specified (${institution}), qualification missing`;
            } else {
                detail = 'Qualification & institution missing';
            }

            return {
                completed,
                detail
            };
        }
    },
    {
        id: 'skills',
        label: 'Skills & Proficiencies',
        category: 'required',
        weight: 20,
        description: 'Add technical and soft skills to improve AI internship matching.',
        actionTarget: 'openModalBtn',
        actionText: 'Add Skills',
        actionType: 'modal',
        icon: 'ph-cpu',
        check: (user = {}) => {
            const structuredSkills = Array.isArray(user && user.skillProfiles)
                ? user.skillProfiles.filter(s => s && s.name && s.name.trim())
                : [];
            const legacySkills = Array.isArray(user && user.skills)
                ? user.skills.filter(s => typeof s === 'string' && s.trim())
                : [];

            const skillCount = structuredSkills.length || legacySkills.length;
            const completed = skillCount > 0;

            return {
                completed,
                detail: completed
                    ? `${skillCount} skill${skillCount === 1 ? '' : 's'} added`
                    : 'No skills listed yet'
            };
        }
    },
    {
        id: 'resume',
        label: 'Resume Upload',
        category: 'required',
        weight: 20,
        description: 'Upload your latest resume (PDF or Word) so employers can review your profile.',
        actionTarget: 'resumeUploadCard',
        actionText: 'Upload Resume',
        actionType: 'scroll',
        icon: 'ph-file-text',
        check: (user = {}) => {
            const hasVersions = Array.isArray(user && user.resumeVersions) && user.resumeVersions.length > 0;
            const hasResumeUrl = Boolean(user && (user.resume || user.resumeUrl));
            const completed = hasVersions || hasResumeUrl;

            let detail = 'No resume on file';
            if (completed) {
                if (user && user.resumeOriginalName) {
                    detail = user.resumeOriginalName;
                } else if (hasVersions && user.resumeVersions[0].fileName) {
                    detail = user.resumeVersions[0].fileName;
                } else {
                    detail = 'Resume uploaded';
                }
            }

            return {
                completed,
                detail
            };
        }
    },
    {
        id: 'projects',
        label: 'Projects & Portfolio',
        category: 'recommended',
        weight: 15,
        description: 'Showcase hands-on projects, code repositories, or live applications.',
        actionTarget: 'projectModal',
        actionText: 'Add Project',
        actionType: 'entryModal',
        icon: 'ph-folder-simple-star',
        check: (user = {}) => {
            const projectCount = Array.isArray(user && user.projects)
                ? user.projects.filter(p => p && p.title && p.title.trim()).length
                : 0;
            const completed = projectCount > 0;

            return {
                completed,
                detail: completed
                    ? `${projectCount} project${projectCount === 1 ? '' : 's'} showcased`
                    : 'No projects added'
            };
        }
    },
    {
        id: 'certifications',
        label: 'Certifications & Credentials',
        category: 'recommended',
        weight: 10,
        description: 'Highlight certifications, completed courses, or verified achievements.',
        actionTarget: 'certModal',
        actionText: 'Add Certificate',
        actionType: 'entryModal',
        icon: 'ph-certificate',
        check: (user = {}) => {
            const certCount = Array.isArray(user && user.certifications)
                ? user.certifications.filter(c => c && c.name && c.name.trim()).length
                : 0;
            const completed = certCount > 0;

            return {
                completed,
                detail: completed
                    ? `${certCount} certification${certCount === 1 ? '' : 's'} listed`
                    : 'No certifications listed'
            };
        }
    }
];

/**
 * Returns tier styling and metadata based on completion percentage.
 * 
 * @param {number} percentage - Integer 0 to 100
 * @returns {object} Badge metadata
 */
function getCompletionBadge(percentage) {
    if (percentage >= 100) {
        return {
            level: 'complete',
            label: 'All-Star Profile',
            colorClass: 'emerald',
            bgClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
            barClass: 'bg-emerald-500',
            fillClass: 'text-emerald-500',
            ringClass: 'stroke-emerald-500',
            icon: 'ph-check-circle'
        };
    }
    if (percentage >= 80) {
        return {
            level: 'high',
            label: 'Strong Profile',
            colorClass: 'indigo',
            bgClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
            barClass: 'bg-indigo-600',
            fillClass: 'text-indigo-600',
            ringClass: 'stroke-indigo-600',
            icon: 'ph-sparkle'
        };
    }
    if (percentage >= 50) {
        return {
            level: 'intermediate',
            label: 'Intermediate',
            colorClass: 'amber',
            bgClass: 'bg-amber-50 text-amber-800 border-amber-200',
            barClass: 'bg-amber-500',
            fillClass: 'text-amber-500',
            ringClass: 'stroke-amber-500',
            icon: 'ph-trend-up'
        };
    }
    return {
        level: 'low',
        label: 'Getting Started',
        colorClass: 'rose',
        bgClass: 'bg-rose-50 text-rose-700 border-rose-200',
        barClass: 'bg-rose-500',
        fillClass: 'text-rose-500',
        ringClass: 'stroke-rose-500',
        icon: 'ph-warning-circle'
    };
}

/**
 * Calculates candidate profile completion score, checklist items, and next action.
 * 
 * @param {object} candidate - User/Candidate object
 * @param {object|Array} [customConfig] - Optional rules or weight overrides
 * @returns {object} Full completion profile
 */
function calculateProfileCompletion(candidate = {}, customConfig = null) {
    let rules = DEFAULT_COMPLETION_RULES;

    if (Array.isArray(customConfig)) {
        rules = customConfig;
    } else if (customConfig && typeof customConfig === 'object') {
        rules = DEFAULT_COMPLETION_RULES.map(rule => {
            if (customConfig[rule.id]) {
                return { ...rule, ...customConfig[rule.id] };
            }
            return rule;
        });
    }

    let earnedWeight = 0;
    let totalWeight = 0;
    const items = [];
    const completedItems = [];
    const missingItems = [];

    for (const rule of rules) {
        const weight = typeof rule.weight === 'number' && rule.weight > 0 ? rule.weight : 0;
        totalWeight += weight;

        let checkResult = { completed: false, detail: '' };
        try {
            if (typeof rule.check === 'function') {
                checkResult = rule.check(candidate) || {};
            }
        } catch (_) {
            checkResult = { completed: false, detail: 'Error evaluating criterion' };
        }

        const isCompleted = Boolean(checkResult.completed);
        const itemEarned = isCompleted ? weight : 0;
        earnedWeight += itemEarned;

        const evaluatedItem = {
            id: rule.id,
            label: rule.label,
            category: rule.category || 'recommended',
            weight,
            earnedWeight: itemEarned,
            completed: isCompleted,
            detail: checkResult.detail || '',
            description: rule.description || '',
            actionTarget: rule.actionTarget || 'openModalBtn',
            actionText: rule.actionText || 'Complete',
            actionType: rule.actionType || 'modal',
            icon: rule.icon || 'ph-check'
        };

        items.push(evaluatedItem);
        if (isCompleted) {
            completedItems.push(evaluatedItem);
        } else {
            missingItems.push(evaluatedItem);
        }
    }

    const percentage = totalWeight > 0 ? Math.min(100, Math.max(0, Math.round((earnedWeight / totalWeight) * 100))) : 0;
    const badge = getCompletionBadge(percentage);
    const isComplete = percentage === 100;

    // Determine the next recommended action (prioritize required items with highest weight)
    let nextAction = null;
    if (missingItems.length > 0) {
        const sortedMissing = [...missingItems].sort((a, b) => {
            if (a.category === 'required' && b.category !== 'required') return -1;
            if (b.category === 'required' && a.category !== 'required') return 1;
            return b.weight - a.weight;
        });
        const topMissing = sortedMissing[0];
        nextAction = {
            id: topMissing.id,
            label: topMissing.label,
            category: topMissing.category,
            weight: topMissing.weight,
            actionTarget: topMissing.actionTarget,
            actionText: topMissing.actionText,
            actionType: topMissing.actionType,
            prompt: `Complete "${topMissing.label}" (+${topMissing.weight}%) to boost your profile strength!`
        };
    }

    const requiredMissingCount = missingItems.filter(i => i.category === 'required').length;
    const recommendedMissingCount = missingItems.filter(i => i.category === 'recommended').length;

    let summaryText = 'Your profile is 100% complete and fully optimized for recruiters!';
    if (!isComplete) {
        if (requiredMissingCount > 0) {
            summaryText = `${requiredMissingCount} essential item${requiredMissingCount === 1 ? '' : 's'} remaining to complete your profile.`;
        } else {
            summaryText = `All essential fields completed! Add ${recommendedMissingCount} recommended item${recommendedMissingCount === 1 ? '' : 's'} to stand out.`;
        }
    }

    return {
        percentage,
        isComplete,
        score: earnedWeight,
        totalWeight,
        level: badge.level,
        badge,
        summaryText,
        items,
        completedItems,
        missingItems,
        requiredMissingCount,
        recommendedMissingCount,
        nextAction
    };
}

module.exports = {
    DEFAULT_COMPLETION_RULES,
    getCompletionBadge,
    calculateProfileCompletion
};
