const test = require('node:test');
const assert = require('node:assert/strict');
const { parseInternshipQuery, buildPaginationData, buildQueryString, escapeRegex } = require('../utils/queryHelper');

test('escapeRegex escapes special regex characters', () => {
    assert.equal(escapeRegex('c++ (developer) [remote]'), 'c\\+\\+ \\(developer\\) \\[remote\\]');
    assert.equal(escapeRegex('test$foo*bar?'), 'test\\$foo\\*bar\\?');
});

test('parseInternshipQuery excludes draft internships by default', () => {
    const { filterObj } = parseInternshipQuery({});
    
    const filterString = JSON.stringify(filterObj);
    assert.ok(filterString.includes('draft'));
    assert.deepEqual(filterObj, { status: { $ne: 'draft' } });
});

test('parseInternshipQuery handles active status filter', () => {
    const { filterObj, state } = parseInternshipQuery({ status: 'active' });
    assert.equal(state.status, 'active');
    assert.deepEqual(filterObj, {
        status: { $nin: ['draft', 'paused'] },
        isPaused: { $ne: true }
    });
});

test('parseInternshipQuery handles paused status filter', () => {
    const { filterObj, state } = parseInternshipQuery({ status: 'paused' });
    assert.equal(state.status, 'paused');
    assert.deepEqual(filterObj, {
        $or: [{ status: 'paused' }, { isPaused: true }]
    });
});

test('parseInternshipQuery combines search, sector, and location conjunctively ($and)', () => {
    const { filterObj } = parseInternshipQuery({
        search: 'developer',
        sector: 'Technology',
        location: 'Bengaluru'
    });

    assert.ok(filterObj.$and, 'Criteria must be combined with $and');
    assert.equal(filterObj.$and.length, 4);

    
    assert.deepEqual(filterObj.$and[0], { status: { $ne: 'draft' } });

    
    assert.ok(filterObj.$and[1].$or);
    assert.equal(filterObj.$and[1].$or.length, 4);

    
    assert.ok(filterObj.$and[2].sector);

    
    assert.ok(filterObj.$and[3].$or);
    assert.equal(filterObj.$and[3].$or.length, 3);
});

test('parseInternshipQuery does not throw on regex special characters in search', () => {
    assert.doesNotThrow(() => {
        parseInternshipQuery({ search: 'c++ (internship) [2026]' });
    });
});

test('buildPaginationData calculates page bounds accurately', () => {
    const p1 = buildPaginationData(25, 1, 10);
    assert.equal(p1.totalPages, 3);
    assert.equal(p1.currentPage, 1);
    assert.equal(p1.startItem, 1);
    assert.equal(p1.endItem, 10);
    assert.equal(p1.hasNextPage, true);
    assert.equal(p1.hasPrevPage, false);
    assert.deepEqual(p1.pages, [1, 2, 3]);

    const p3 = buildPaginationData(25, 3, 10);
    assert.equal(p3.totalPages, 3);
    assert.equal(p3.currentPage, 3);
    assert.equal(p3.startItem, 21);
    assert.equal(p3.endItem, 25);
    assert.equal(p3.hasNextPage, false);
    assert.equal(p3.hasPrevPage, true);
    assert.deepEqual(p3.pages, [1, 2, 3]);
});

test('buildQueryString preserves query state while updating overrides', () => {
    const current = { search: 'software', sector: 'IT', status: 'active', page: 2 };
    const nextUrl = buildQueryString(current, { page: 3 });

    assert.ok(nextUrl.includes('search=software'));
    assert.ok(nextUrl.includes('sector=IT'));
    assert.ok(nextUrl.includes('status=active'));
    assert.ok(nextUrl.includes('page=3'));
});
