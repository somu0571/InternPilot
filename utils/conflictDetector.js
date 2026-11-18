






const FIELD_DEFS = [
    {
        key: 'skills',
        label: 'Skills',
        get: (o) => o.skills,
        type: 'array'
    },
    {
        key: 'education.qualification',
        label: 'Qualification',
        get: (o) => o.education?.qualification || o.qualification,
        type: 'string'
    },
    {
        key: 'education.institutionName',
        label: 'Institution',
        get: (o) => o.education?.institutionName || o.institution,
        type: 'string'
    },
    {
        key: 'location.district',
        label: 'District',
        get: (o) => o.location?.district,
        type: 'string'
    },
    {
        key: 'location.state',
        label: 'State',
        get: (o) => o.location?.state,
        type: 'string'
    },
    {
        key: 'name',
        label: 'Full Name',
        get: (o) => o.name,
        type: 'string'
    },
    {
        key: 'age',
        label: 'Age',
        get: (o) => o.age,
        type: 'string'   
    },
    {
        key: 'familyIncome',
        label: 'Family Income',
        get: (o) => o.familyIncome,
        type: 'string'
    }
];




function isEmpty(val) {
    if (val === null || val === undefined) return true;
    if (typeof val === 'string' && val.trim() === '') return true;
    if (Array.isArray(val) && val.length === 0) return true;
    return false;
}


function normStr(val) {
    if (val === null || val === undefined) return '';
    return String(val).trim().toLowerCase();
}


function normArr(arr) {
    if (!Array.isArray(arr)) return [];
    return [...new Set(arr.filter(Boolean).map(s => String(s).trim().toLowerCase()))].sort();
}


function isEqual(a, b, type) {
    if (type === 'array') {
        const na = normArr(a);
        const nb = normArr(b);
        return na.length === nb.length && na.every((v, i) => v === nb[i]);
    }
    return normStr(a) === normStr(b);
}


function displayValue(val) {
    if (isEmpty(val)) return '';
    if (Array.isArray(val)) return val.filter(Boolean).join(', ');
    return String(val).trim();
}




function detectProfileConflicts(existingProfile, parsedData) {
    const conflicts = [];
    const autoMerged = {};

    for (const field of FIELD_DEFS) {
        const current = field.get(existingProfile || {});
        const parsed  = field.get(parsedData || {});

        const currentEmpty = isEmpty(current);
        const parsedEmpty  = isEmpty(parsed);

        
        if (currentEmpty && parsedEmpty) continue;

        
        if (currentEmpty && !parsedEmpty) {
            autoMerged[field.key] = parsed;
            continue;
        }
        if (!currentEmpty && parsedEmpty) {
            
            continue;
        }

        
        if (isEqual(current, parsed, field.type)) {
            
            continue;
        }

        
        conflicts.push({
            fieldKey:     field.key,
            fieldLabel:   field.label,
            currentValue: displayValue(current),
            parsedValue:  displayValue(parsed)
        });
    }

    return {
        hasConflicts: conflicts.length > 0,
        conflicts,
        autoMerged
    };
}

module.exports = { detectProfileConflicts, FIELD_DEFS };
