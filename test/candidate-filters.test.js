const test = require('node:test');
const assert = require('node:assert/strict');
const {
    parseCandidateFilters,
    applyCandidateFilters,
    buildCandidateFilterOptions,
    buildFilterQuery,
    candidateFilterChips,
    candidateSkills,
    candidateLocation,
    portfolioSize,
    normalizeStatus
} = require('../utils/candidateFilters');

const person = (name, extra = {}) => ({
    name,
    skills: [],
    education: { qualification: '' },
    location: { district: '', state: '' },
    projects: [],
    certifications: [],
    ...extra
});

const app = (id, candidate, extra = {}) => ({ id, status: 'Submitted', matchScore: 0, candidate, ...extra });

const POOL = [
    app('asha', person('Asha', {
        skills: ['React', 'Node.js'], education: { qualification: 'B.Tech' },
        location: { district: 'Pune', state: 'Maharashtra' }, projects: [{}, {}], certifications: [{}]
    }), { status: 'Shortlisted', matchScore: 80 }),
    app('ravi', person('Ravi', {
        skills: ['react', 'Python'], education: { qualification: 'BCA' },
        location: { district: 'Jaipur', state: 'Rajasthan' }, projects: [{}]
    }), { status: 'Submitted', matchScore: 45 }),
    app('meera', person('Meera', {
        skills: ['Python', 'SQL'], education: { qualification: 'b.tech' },
        location: { district: 'Pune', state: 'Maharashtra' }
    }), { status: 'pending', matchScore: 20 }),
    app('ghost', null, { status: 'Rejected', matchScore: 90 })
];

const ids = list => list.map(a => a.id);


const toQuery = search => {
    const params = new URLSearchParams(search);
    const query = {};
    for (const key of new Set(params.keys())) {
        const all = params.getAll(key);
        query[key] = all.length > 1 ? all : all[0];
    }
    return query;
};

test('empty query applies no filters', () => {
    const filters = parseCandidateFilters({});
    assert.deepEqual(filters, { skills: [], qualification: [], location: [], status: [], experience: '', minMatch: 0 });
    assert.deepEqual(ids(applyCandidateFilters(POOL, filters)), ['asha', 'ravi', 'meera', 'ghost']);
});

test('parseCandidateFilters normalises and drops junk', () => {
    const filters = parseCandidateFilters({
        skills: ['React', 'react', ''],
        status: ['Shortlisted', 'pending', 'Nonsense', 'Shortlisted'],
        experience: '7',
        minMatch: '150'
    });
    assert.deepEqual(filters.skills, ['React']);
    assert.deepEqual(filters.status, ['Shortlisted', 'Submitted'], 'pending becomes Submitted, junk and repeats dropped');
    assert.equal(filters.experience, '', 'only known experience levels are kept');
    assert.equal(filters.minMatch, 100, 'match score is clamped to 0-100');
    assert.equal(parseCandidateFilters({ minMatch: '-20' }).minMatch, 0);
    assert.equal(parseCandidateFilters({ minMatch: 'lots' }).minMatch, 0);
});

test('skills must all be present, compared case-insensitively', () => {
    assert.deepEqual(ids(applyCandidateFilters(POOL, parseCandidateFilters({ skills: 'REACT' }))), ['asha', 'ravi']);
    assert.deepEqual(ids(applyCandidateFilters(POOL, parseCandidateFilters({ skills: ['React', 'Node.js'] }))), ['asha'],
        'adding a skill narrows the pool');
});

test('skills are read from skill profiles when a candidate has them', () => {
    const withProfiles = person('Kiran', { skills: ['Java'], skillProfiles: [{ name: 'Go', proficiency: 'Advanced' }] });
    assert.deepEqual(candidateSkills(withProfiles), ['Go']);
    const result = applyCandidateFilters([app('kiran', withProfiles)], parseCandidateFilters({ skills: 'Go' }));
    assert.deepEqual(ids(result), ['kiran']);
});

test('qualification matches any ticked value, ignoring case', () => {
    const result = applyCandidateFilters(POOL, parseCandidateFilters({ qualification: 'B.Tech' }));
    assert.deepEqual(ids(result), ['asha', 'meera']);
});

test('location matches the district and state label', () => {
    const result = applyCandidateFilters(POOL, parseCandidateFilters({ location: 'Pune, Maharashtra' }));
    assert.deepEqual(ids(result), ['asha', 'meera']);
});

test('experience counts projects plus certifications', () => {
    assert.equal(portfolioSize(POOL[0].candidate), 3);
    assert.deepEqual(ids(applyCandidateFilters(POOL, parseCandidateFilters({ experience: '1' }))), ['asha', 'ravi']);
    assert.deepEqual(ids(applyCandidateFilters(POOL, parseCandidateFilters({ experience: '3' }))), ['asha']);
});

test('minimum AI match score', () => {
    assert.deepEqual(ids(applyCandidateFilters(POOL, parseCandidateFilters({ minMatch: '45' }))), ['asha', 'ravi', 'ghost']);
});

test('status filter treats the legacy pending value as Submitted', () => {
    assert.equal(normalizeStatus('pending'), 'Submitted');
    const result = applyCandidateFilters(POOL, parseCandidateFilters({ status: 'Submitted' }));
    assert.deepEqual(ids(result), ['ravi', 'meera']);
});

test('filters combine with AND across categories', () => {
    const filters = parseCandidateFilters({ location: 'Pune, Maharashtra', qualification: 'B.Tech', minMatch: '50' });
    assert.deepEqual(ids(applyCandidateFilters(POOL, filters)), ['asha']);
});

test('a deleted account only drops out when a profile filter is used', () => {
    assert.ok(ids(applyCandidateFilters(POOL, parseCandidateFilters({ status: 'Rejected' }))).includes('ghost'));
    assert.ok(!ids(applyCandidateFilters(POOL, parseCandidateFilters({ qualification: 'BCA' }))).includes('ghost'));
});

test('filter options come from the pool, with counts and merged case variants', () => {
    const options = buildCandidateFilterOptions(POOL);
    assert.deepEqual(options.skills, [
        { value: 'Node.js', count: 1 },
        { value: 'Python', count: 2 },
        { value: 'React', count: 2 },
        { value: 'SQL', count: 1 }
    ]);
    assert.deepEqual(options.qualification, [{ value: 'B.Tech', count: 2 }, { value: 'BCA', count: 1 }]);
    assert.deepEqual(options.status.map(s => s.value), ['Submitted', 'Shortlisted', 'Rejected'], 'pipeline order, present only');
    assert.equal(options.status[0].count, 2, 'pending counted as Submitted');
});

test('a candidate who lists a skill twice is counted once', () => {
    const dup = [app('x', person('X', { skills: ['React', 'react'] }))];
    assert.deepEqual(buildCandidateFilterOptions(dup).skills, [{ value: 'React', count: 1 }]);
});

test('each chip removes only its own value', () => {
    const filters = parseCandidateFilters({ skills: ['React', 'SQL'], experience: '3', minMatch: '60', status: 'Shortlisted' });
    const chips = candidateFilterChips(filters, '/company/internships/abc/applicants');

    assert.deepEqual(chips.map(c => c.label), [
        'Skill: React',
        'Skill: SQL',
        'Experience: 3+ projects or certifications',
        'Match: 60%+',
        'Status: Shortlisted'
    ]);

    const afterReact = new URL(chips[0].href, 'http://localhost').searchParams;
    assert.equal(afterReact.get('skills'), 'SQL');
    assert.equal(afterReact.get('minMatch'), '60');

    const afterMatch = new URL(chips[3].href, 'http://localhost').searchParams;
    assert.equal(afterMatch.get('minMatch'), null);
    assert.equal(afterMatch.get('experience'), '3');
});

test('state survives a round trip through the URL', () => {
    const first = parseCandidateFilters({ skills: 'React', location: 'Pune, Maharashtra', status: 'Interview', minMatch: '40' });
    const search = buildFilterQuery(first);
    assert.deepEqual(parseCandidateFilters(toQuery(search)), first);
});

test('values containing a comma are never split', () => {
    const one = parseCandidateFilters({ location: 'Pune, Maharashtra', qualification: 'B.Sc, Maths' });
    assert.deepEqual(one.location, ['Pune, Maharashtra']);
    assert.deepEqual(one.qualification, ['B.Sc, Maths']);

    const two = parseCandidateFilters(toQuery(buildFilterQuery({
        ...one, location: ['Pune, Maharashtra', 'Jaipur, Rajasthan']
    })));
    assert.deepEqual(two.location, ['Pune, Maharashtra', 'Jaipur, Rajasthan']);
});

test('location handles both the object and the plain string form', () => {
    assert.equal(candidateLocation({ location: { district: 'Pune', state: '' } }), 'Pune');
    assert.equal(candidateLocation({ location: 'Remote' }), 'Remote');
    assert.equal(candidateLocation(null), '');
});
