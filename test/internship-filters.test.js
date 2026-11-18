const test = require('node:test');
const assert = require('node:assert/strict');
const {
    parseInternshipQuery,
    buildQueryString,
    parseList,
    parseAmount,
    parseDurationMonths,
    isInDurationBucket,
    applyDurationFilter,
    getActiveFilters,
    clearFiltersHref,
    uniqueSortedOptions
} = require('../utils/queryHelper');


const conditionFor = (filterObj, field) =>
    (filterObj.$and || [filterObj]).find(c => Object.prototype.hasOwnProperty.call(c, field));

test('parseList accepts repeated keys or a comma separated string', () => {
    assert.deepEqual(parseList(['React', 'Node.js']), ['React', 'Node.js']);
    assert.deepEqual(parseList('React, Node.js'), ['React', 'Node.js']);
});

test('parseList drops blanks, non-strings and case-insensitive duplicates', () => {
    assert.deepEqual(parseList(['React', ' react ', '', 'SQL', { evil: 1 }]), ['React', 'SQL']);
    assert.deepEqual(parseList(undefined), []);
});

test('parseList caps the number of values', () => {
    const many = Array.from({ length: 50 }, (_, i) => 'skill' + i);
    assert.equal(parseList(many).length, 20);
});

test('parseAmount reads rupee amounts and rejects junk', () => {
    assert.equal(parseAmount('5000'), 5000);
    assert.equal(parseAmount('5,000'), 5000);
    assert.equal(parseAmount('₹ 7500'), 7500);
    assert.equal(parseAmount('2500.9'), 2500);
    assert.equal(parseAmount(['4000', '9000']), 4000);
    assert.equal(parseAmount(''), null);
    assert.equal(parseAmount('-10'), null);
    assert.equal(parseAmount('abc'), null);
});

test('parseDurationMonths understands the common ways duration is written', () => {
    assert.equal(parseDurationMonths('12 Months'), 12);
    assert.equal(parseDurationMonths('6 months'), 6);
    assert.equal(parseDurationMonths('1 Year'), 12);
    assert.equal(parseDurationMonths('2 yrs'), 24);
    assert.equal(parseDurationMonths('3'), 3, 'a bare number is months');
    assert.ok(Math.abs(parseDurationMonths('8 weeks') - 1.846) < 0.01);
    assert.ok(Math.abs(parseDurationMonths('45 days') - 1.479) < 0.01);
    assert.equal(parseDurationMonths('Flexible'), null);
    assert.equal(parseDurationMonths('0 months'), null);
    assert.equal(parseDurationMonths(null), null);
});

test('duration buckets share no boundaries', () => {
    assert.equal(isInDurationBucket(3, 'upto3'), true);
    assert.equal(isInDurationBucket(3, '3to6'), false, '3 belongs to the first bucket only');
    assert.equal(isInDurationBucket(3.5, '3to6'), true);
    assert.equal(isInDurationBucket(12, '6to12'), true);
    assert.equal(isInDurationBucket(12, 'over12'), false);
    assert.equal(isInDurationBucket(13, 'over12'), true);
    assert.equal(isInDurationBucket(null, 'upto3'), false);
    assert.equal(isInDurationBucket(5, 'nonsense'), false);
});

test('no new filter params leaves the existing query untouched', () => {
    const { filterObj, state } = parseInternshipQuery({});
    assert.deepEqual(filterObj, { status: { $ne: 'draft' } });
    assert.deepEqual(state.skills, []);
    assert.deepEqual(state.duration, []);
    assert.equal(state.minStipend, '');
    assert.equal(state.maxStipend, '');
});

test('skills filter matches any chosen skill, case-insensitively and exactly', () => {
    const { filterObj } = parseInternshipQuery({ skills: 'react,C++' });
    const { requiredSkills } = conditionFor(filterObj, 'requiredSkills');
    const [react, cpp] = requiredSkills.$in;

    assert.ok(react.test('React') && react.test('REACT'));
    assert.ok(!react.test('React Native'), 'no partial matches');
    assert.ok(cpp.test('c++'), 'regex characters in a skill are escaped');
});

test('stipend range builds $gte and $lte, either end optional', () => {
    const both = parseInternshipQuery({ minStipend: '5000', maxStipend: '15000' });
    assert.deepEqual(conditionFor(both.filterObj, 'monthlyStipend').monthlyStipend, { $gte: 5000, $lte: 15000 });

    const minOnly = parseInternshipQuery({ minStipend: '8000' });
    assert.deepEqual(conditionFor(minOnly.filterObj, 'monthlyStipend').monthlyStipend, { $gte: 8000 });
});

test('a backwards stipend range is swapped rather than matching nothing', () => {
    const { filterObj, state } = parseInternshipQuery({ minStipend: '20000', maxStipend: '5000' });
    assert.deepEqual(conditionFor(filterObj, 'monthlyStipend').monthlyStipend, { $gte: 5000, $lte: 20000 });
    assert.equal(state.minStipend, '5000');
    assert.equal(state.maxStipend, '20000');
});

test('invalid stipend values are ignored', () => {
    const { filterObj } = parseInternshipQuery({ minStipend: 'lots', maxStipend: '-1' });
    assert.equal(conditionFor(filterObj, 'monthlyStipend'), undefined);
});

test('unknown duration keys are dropped from state', () => {
    const { state } = parseInternshipQuery({ duration: ['3to6', 'forever', 'over12'] });
    assert.deepEqual(state.duration, ['3to6', 'over12']);
});

test('every filter combines with AND alongside search and status', () => {
    const { filterObj } = parseInternshipQuery({
        status: 'active',
        search: 'developer',
        sector: 'IT',
        location: 'Pune',
        skills: 'React',
        minStipend: '5000'
    });
    assert.equal(filterObj.$and.length, 6);
});

test('buildQueryString joins list values and skips empty lists', () => {
    assert.equal(buildQueryString({ skills: ['React', 'SQL'] }, {}), '?skills=React%2CSQL');
    assert.equal(buildQueryString({ skills: [] }, {}), '/internships');
});

test('the default page size stays out of generated URLs', () => {
    const { state } = parseInternshipQuery({});
    assert.equal(clearFiltersHref(state), '/internships', 'clear all gives a bare URL');
    assert.equal(buildQueryString({ limit: 12 }, {}), '/internships', 'the default size is omitted');
    assert.ok(buildQueryString({ limit: 24 }, {}).includes('limit=24'), 'a non-default size is kept');
});

test('state survives a round trip through the URL', () => {
    const first = parseInternshipQuery({ skills: 'React,SQL', duration: '3to6', minStipend: '5000', search: 'dev' }).state;
    const url = new URL(buildQueryString(first, {}), 'http://localhost/internships');
    const second = parseInternshipQuery(Object.fromEntries(url.searchParams)).state;

    assert.deepEqual(second.skills, first.skills);
    assert.deepEqual(second.duration, first.duration);
    assert.equal(second.minStipend, first.minStipend);
    assert.equal(second.search, first.search);
});

test('getActiveFilters returns one chip per value, and removing one keeps the rest', () => {
    const { state } = parseInternshipQuery({
        sector: 'IT',
        skills: 'React,SQL',
        minStipend: '5000',
        maxStipend: '15000',
        duration: '3to6',
        search: 'dev',
        sort: 'stipend_high'
    });
    const chips = getActiveFilters(state);

    assert.deepEqual(chips.map(c => c.label), [
        'Industry: IT',
        'Skill: React',
        'Skill: SQL',
        'Stipend: ₹5,000 – ₹15,000',
        'Duration: 3 to 6 months'
    ]);

    const removeReact = new URL(chips[1].href, 'http://localhost/internships').searchParams;
    assert.equal(removeReact.get('skills'), 'SQL');
    assert.equal(removeReact.get('sector'), 'IT');
    assert.equal(removeReact.get('search'), 'dev', 'search is kept');
    assert.equal(removeReact.get('sort'), 'stipend_high', 'sort is kept');
});

test('search, sort and status are not counted as filters', () => {
    const { state } = parseInternshipQuery({ search: 'dev', sort: 'vacancies', status: 'active' });
    assert.deepEqual(getActiveFilters(state), []);
});

test('clear all drops filters but keeps search, sort and status', () => {
    const { state } = parseInternshipQuery({
        search: 'dev', sort: 'vacancies', status: 'active', sector: 'IT', skills: 'React', duration: 'upto3'
    });
    const params = new URL(clearFiltersHref(state), 'http://localhost/internships').searchParams;

    assert.equal(params.get('search'), 'dev');
    assert.equal(params.get('sort'), 'vacancies');
    assert.equal(params.get('status'), 'active');
    assert.equal(params.get('sector'), null);
    assert.equal(params.get('skills'), null);
    assert.equal(params.get('duration'), null);
});

test('applyDurationFilter leaves the filter alone when no duration is chosen', async () => {
    const base = { status: { $ne: 'draft' } };
    const model = { find() { throw new Error('should not query'); } };
    assert.equal(await applyDurationFilter(base, [], model), base);
});

test('applyDurationFilter keeps only listings whose duration falls in a chosen bucket', async () => {
    const docs = [
        { _id: 'a', duration: '2 Months' },
        { _id: 'b', duration: '6 months' },
        { _id: 'c', duration: '1 Year' },
        { _id: 'd', duration: 'Flexible' },
        { _id: 'e', duration: '18 months' }
    ];
    let usedFilter;
    const model = {
        find(filter) { usedFilter = filter; return this; },
        select() { return this; },
        lean() { return Promise.resolve(docs); }
    };
    const base = { status: { $ne: 'draft' } };
    const result = await applyDurationFilter(base, ['upto3', 'over12'], model);

    assert.equal(usedFilter, base, 'only listings passing the other filters are checked');
    assert.deepEqual(result, { $and: [base, { _id: { $in: ['a', 'e'] } }] });
});

test('uniqueSortedOptions merges case variants and sorts', () => {
    assert.deepEqual(uniqueSortedOptions(['sql', 'React', 'SQL', ' react', '', null, 'Docker']), ['Docker', 'React', 'sql']);
});
