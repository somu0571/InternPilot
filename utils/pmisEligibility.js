

const PMIS_RULES = {
    age: {
        min: 21,
        max: 24,
        required: true,
        label: 'Age (21–24 years)'
    },
    familyIncome: {
        max: 800000,
        required: true,
        label: 'Annual Family Income (≤ ₹8,00,000)'
    },
    qualification: {
        required: true,
        label: 'Educational Qualification'
    },
    enrollmentStatus: {
        required: true,
        label: 'Formal Education Status',
        disallowedValues: ['full_time', 'full-time', 'enrolled_full_time'],
        disallowedReason: 'Candidates currently enrolled in full-time formal education are not eligible.'
    },
    employmentStatus: {
        required: true,
        label: 'Regular Employment Status',
        disallowedValues: ['full_time', 'full-time', 'employed_full_time'],
        disallowedReason: 'Candidates currently engaged in full-time regular employment are not eligible.'
    }
};


function formatCurrency(amount) {
    const num = Number(amount);
    if (isNaN(num)) return '₹N/A';
    return '₹' + num.toLocaleString('en-IN');
}


function checkPmisEligibility(candidate = {}, customConfig = {}) {
    
    const rules = {
        age: { ...PMIS_RULES.age, ...(customConfig.age || {}) },
        familyIncome: { ...PMIS_RULES.familyIncome, ...(customConfig.familyIncome || {}) },
        qualification: { ...PMIS_RULES.qualification, ...(customConfig.qualification || {}) },
        enrollmentStatus: { ...PMIS_RULES.enrollmentStatus, ...(customConfig.enrollmentStatus || {}) },
        employmentStatus: { ...PMIS_RULES.employmentStatus, ...(customConfig.employmentStatus || {}) }
    };

    const reasons = [];
    const missingFields = [];

    
    const rawAge = candidate ? candidate.age : undefined;
    const hasAge = rawAge !== undefined && rawAge !== null && rawAge !== '' && !isNaN(Number(rawAge)) && Number(rawAge) > 0;
    const ageNum = hasAge ? Number(rawAge) : null;

    const rawIncome = candidate ? candidate.familyIncome : undefined;
    const hasIncome = rawIncome !== undefined && rawIncome !== null && rawIncome !== '' && !isNaN(Number(rawIncome)) && Number(rawIncome) >= 0;
    const incomeNum = hasIncome ? Number(rawIncome) : null;

    const qualification = candidate ? (
        (candidate.education && candidate.education.qualification) ||
        candidate.qualification ||
        ''
    ).toString().trim() : '';
    const hasQualification = Boolean(qualification);

    const enrollment = candidate && candidate.enrollmentStatus ? candidate.enrollmentStatus.toString().trim().toLowerCase() : '';
    const hasEnrollment = Boolean(enrollment);

    const employment = candidate && candidate.employmentStatus ? candidate.employmentStatus.toString().trim().toLowerCase() : '';
    const hasEmployment = Boolean(employment);

    
    let ageStatus = 'pass';
    if (hasAge) {
        if (ageNum < rules.age.min) {
            reasons.push(`Age (${ageNum}) is below the minimum required age of ${rules.age.min} years.`);
            ageStatus = 'fail';
        } else if (ageNum > rules.age.max) {
            reasons.push(`Age (${ageNum}) exceeds the maximum permitted age of ${rules.age.max} years.`);
            ageStatus = 'fail';
        }
    } else if (rules.age.required) {
        ageStatus = 'missing';
        missingFields.push(`Age is not specified (must be between ${rules.age.min} and ${rules.age.max} years).`);
    }

    let incomeStatus = 'pass';
    if (hasIncome) {
        if (incomeNum > rules.familyIncome.max) {
            reasons.push(`Annual family income (${formatCurrency(incomeNum)}) exceeds the maximum ceiling of ${formatCurrency(rules.familyIncome.max)}.`);
            incomeStatus = 'fail';
        }
    } else if (rules.familyIncome.required) {
        incomeStatus = 'missing';
        missingFields.push(`Annual family income is not specified (must be ≤ ${formatCurrency(rules.familyIncome.max)}).`);
    }

    let qualificationStatus = 'pass';
    if (!hasQualification) {
        if (rules.qualification.required) {
            qualificationStatus = 'missing';
            missingFields.push('Educational qualification is not specified.');
        }
    }

    let enrollmentStatusResult = 'pass';
    if (hasEnrollment) {
        if (rules.enrollmentStatus.disallowedValues && rules.enrollmentStatus.disallowedValues.includes(enrollment)) {
            reasons.push(rules.enrollmentStatus.disallowedReason);
            enrollmentStatusResult = 'fail';
        }
    } else if (rules.enrollmentStatus.required) {
        enrollmentStatusResult = 'missing';
        missingFields.push('Enrollment status is not specified (required to verify formal education status).');
    }

    let employmentStatusResult = 'pass';
    if (hasEmployment) {
        if (rules.employmentStatus.disallowedValues && rules.employmentStatus.disallowedValues.includes(employment)) {
            reasons.push(rules.employmentStatus.disallowedReason);
            employmentStatusResult = 'fail';
        }
    } else if (rules.employmentStatus.required) {
        employmentStatusResult = 'missing';
        missingFields.push('Employment status is not specified (required to verify regular employment status).');
    }

    
    let status = 'eligible';
    if (reasons.length > 0) {
        status = 'ineligible';
    } else if (missingFields.length > 0) {
        status = 'incomplete';
    }

    const isEligible = status === 'eligible';

    
    let badge = {};
    if (status === 'eligible') {
        badge = {
            label: 'Eligible',
            text: 'Eligible',
            status: 'eligible',
            variant: 'success',
            colorClass: 'emerald',
            bgClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
            icon: 'ph-check-circle'
        };
    } else if (status === 'ineligible') {
        badge = {
            label: 'Not Eligible',
            text: 'Not Eligible',
            status: 'ineligible',
            variant: 'danger',
            colorClass: 'rose',
            bgClass: 'bg-rose-50 text-rose-700 border-rose-200',
            icon: 'ph-x-circle'
        };
    } else {
        badge = {
            label: 'Incomplete — More Info Needed',
            text: 'Incomplete — More Info Needed',
            status: 'incomplete',
            variant: 'warning',
            colorClass: 'amber',
            bgClass: 'bg-amber-50 text-amber-800 border-amber-200',
            icon: 'ph-warning-circle'
        };
    }

    
    const criteria = [
        {
            key: 'age',
            label: `Age (${rules.age.min}–${rules.age.max} years)`,
            status: ageStatus,
            value: hasAge ? `${ageNum} years` : 'Not provided',
            message: ageStatus === 'pass'
                ? `Age (${ageNum}) is within the ${rules.age.min}–${rules.age.max} permitted range.`
                : (ageStatus === 'fail'
                    ? (ageNum < rules.age.min ? `Age (${ageNum}) is below ${rules.age.min} years.` : `Age (${ageNum}) exceeds ${rules.age.max} years.`)
                    : 'Age is missing from profile.')
        },
        {
            key: 'familyIncome',
            label: `Annual Family Income (≤ ${formatCurrency(rules.familyIncome.max)})`,
            status: incomeStatus,
            value: hasIncome ? `${formatCurrency(incomeNum)} / year` : 'Not provided',
            message: incomeStatus === 'pass'
                ? `Income (${formatCurrency(incomeNum)}) is within the ${formatCurrency(rules.familyIncome.max)} ceiling.`
                : (incomeStatus === 'fail'
                    ? `Income (${formatCurrency(incomeNum)}) exceeds the ${formatCurrency(rules.familyIncome.max)} ceiling.`
                    : 'Annual family income is missing from profile.')
        },
        {
            key: 'qualification',
            label: 'Educational Qualification',
            status: qualificationStatus,
            value: hasQualification ? qualification : 'Not provided',
            message: qualificationStatus === 'pass'
                ? `Qualification recorded: ${qualification}.`
                : 'Educational qualification is missing from profile.'
        },
        {
            key: 'enrollmentStatus',
            label: 'Formal Education Enrollment',
            status: enrollmentStatusResult,
            value: hasEnrollment
                ? (enrollment === 'full_time'
                    ? 'Full-time formal education'
                    : (enrollment === 'part_time_or_distance'
                        ? 'Part-time / Distance learning'
                        : (enrollment === 'not_enrolled' ? 'Not enrolled / Completed' : enrollment)))
                : 'Not provided',
            message: enrollmentStatusResult === 'pass'
                ? 'Not enrolled in full-time formal education.'
                : (enrollmentStatusResult === 'fail'
                    ? 'Currently enrolled in full-time formal education.'
                    : 'Enrollment status is not specified.')
        },
        {
            key: 'employmentStatus',
            label: 'Regular Employment Status',
            status: employmentStatusResult,
            value: hasEmployment
                ? (employment === 'full_time'
                    ? 'Full-time regular employment'
                    : (employment === 'part_time_or_freelance'
                        ? 'Part-time / Freelance'
                        : (employment === 'unemployed' ? 'Unemployed / Seeking internship' : employment)))
                : 'Not provided',
            message: employmentStatusResult === 'pass'
                ? 'Not in full-time regular employment.'
                : (employmentStatusResult === 'fail'
                    ? 'Currently engaged in full-time regular employment.'
                    : 'Employment status is not specified.')
        }
    ];

    return {
        status,
        isEligible,
        badge,
        reasons,
        missingFields,
        criteria,
        rules
    };
}

module.exports = {
    PMIS_RULES,
    checkPmisEligibility,
    formatCurrency
};
