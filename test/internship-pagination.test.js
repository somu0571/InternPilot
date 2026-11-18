const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ejs = require('ejs');

const {
    DEFAULT_LIMIT,
    parseInternshipQuery,
    buildPaginationData,
    getPaginationRange,
    buildQueryString
} = require('../utils/queryHelper');

const internshipsViewPath = path.join(__dirname, '..', 'views', 'extras', 'internships.ejs');
const internshipsTemplate = fs.readFileSync(internshipsViewPath, 'utf8');

test('Issue #9: default page size is in the sensible range of 12-20 items', () => {
    assert.ok(DEFAULT_LIMIT >= 12 && DEFAULT_LIMIT <= 20, `DEFAULT_LIMIT (${DEFAULT_LIMIT}) must be between 12 and 20`);
    assert.equal(DEFAULT_LIMIT, 12);

    const { limit, state } = parseInternshipQuery({});
    assert.equal(limit, 12);
    assert.equal(state.limit, 12);
});

test('Issue #9: buildPaginationData calculates page bounds, items and navigation indicators', () => {
    
    const p1 = buildPaginationData(25, 1, 12);
    assert.equal(p1.totalItems, 25);
    assert.equal(p1.totalPages, 3);
    assert.equal(p1.currentPage, 1);
    assert.equal(p1.limit, 12);
    assert.equal(p1.skip, 0);
    assert.equal(p1.startItem, 1);
    assert.equal(p1.endItem, 12);
    assert.equal(p1.hasPrevPage, false);
    assert.equal(p1.hasNextPage, true);
    assert.equal(p1.nextPage, 2);

    const p2 = buildPaginationData(25, 2, 12);
    assert.equal(p2.currentPage, 2);
    assert.equal(p2.skip, 12);
    assert.equal(p2.startItem, 13);
    assert.equal(p2.endItem, 24);
    assert.equal(p2.hasPrevPage, true);
    assert.equal(p2.hasNextPage, true);
    assert.equal(p2.prevPage, 1);
    assert.equal(p2.nextPage, 3);

    const p3 = buildPaginationData(25, 3, 12);
    assert.equal(p3.currentPage, 3);
    assert.equal(p3.skip, 24);
    assert.equal(p3.startItem, 25);
    assert.equal(p3.endItem, 25);
    assert.equal(p3.hasPrevPage, true);
    assert.equal(p3.hasNextPage, false);
    assert.equal(p3.prevPage, 2);
});

test('Issue #9: buildPaginationData handles empty results and clamps out-of-bounds pages', () => {
    
    const empty = buildPaginationData(0, 1, 12);
    assert.equal(empty.totalItems, 0);
    assert.equal(empty.totalPages, 1);
    assert.equal(empty.currentPage, 1);
    assert.equal(empty.startItem, 0);
    assert.equal(empty.endItem, 0);
    assert.equal(empty.hasNextPage, false);
    assert.equal(empty.hasPrevPage, false);

    
    const neg = buildPaginationData(25, -5, 12);
    assert.equal(neg.currentPage, 1);
    assert.equal(neg.skip, 0);

    const zero = buildPaginationData(25, 0, 12);
    assert.equal(zero.currentPage, 1);
    assert.equal(zero.skip, 0);

    
    const overflow = buildPaginationData(25, 999, 12);
    assert.equal(overflow.currentPage, 3);
    assert.equal(overflow.skip, 24);
});

test('Issue #9: getPaginationRange produces clean numbered pages and symmetric ellipses', () => {
    
    assert.deepEqual(getPaginationRange(1, 5), [1, 2, 3, 4, 5]);
    assert.deepEqual(getPaginationRange(3, 5), [1, 2, 3, 4, 5]);

    
    assert.deepEqual(getPaginationRange(4, 7), [1, 2, 3, 4, 5, 6, 7]);

    
    assert.deepEqual(getPaginationRange(1, 10), [1, 2, 3, 4, 5, '...', 10]);
    assert.deepEqual(getPaginationRange(4, 10), [1, 2, 3, 4, 5, '...', 10]);

    
    assert.deepEqual(getPaginationRange(7, 10), [1, '...', 6, 7, 8, 9, 10]);
    assert.deepEqual(getPaginationRange(10, 10), [1, '...', 6, 7, 8, 9, 10]);

    
    assert.deepEqual(getPaginationRange(5, 10), [1, '...', 4, 5, 6, '...', 10]);
    assert.deepEqual(getPaginationRange(6, 10), [1, '...', 5, 6, 7, '...', 10]);
});

test('Issue #9: pagination state preserves search, filters, and sort options across page links', () => {
    const activeState = {
        search: 'full stack developer',
        sector: 'Information Technology',
        location: 'Bengaluru',
        status: 'active',
        sort: 'stipend_high',
        skills: ['React', 'Node.js'],
        minStipend: '10000',
        maxStipend: '25000',
        duration: ['3to6'],
        page: 1,
        limit: 12
    };

    
    const page2Url = buildQueryString(activeState, { page: 2 });
    assert.ok(page2Url.includes('page=2'), 'must include page=2');
    assert.ok(page2Url.includes('search=full+stack+developer'), 'must preserve search');
    assert.ok(page2Url.includes('sector=Information+Technology'), 'must preserve sector');
    assert.ok(page2Url.includes('location=Bengaluru'), 'must preserve location');
    assert.ok(page2Url.includes('status=active'), 'must preserve status');
    assert.ok(page2Url.includes('sort=stipend_high'), 'must preserve sort');
    assert.ok(page2Url.includes('skills=React%2CNode.js'), 'must preserve skills');
    assert.ok(page2Url.includes('minStipend=10000'), 'must preserve minStipend');
    assert.ok(page2Url.includes('maxStipend=25000'), 'must preserve maxStipend');
    assert.ok(page2Url.includes('duration=3to6'), 'must preserve duration');
    assert.ok(!page2Url.includes('limit=12'), 'default limit 12 is omitted from URL');

    
    const page1Url = buildQueryString(activeState, { page: 1 });
    assert.ok(!page1Url.includes('page='), 'page=1 should be omitted from URL');
    assert.ok(page1Url.includes('search=full+stack+developer'));

    
    const customLimitUrl = buildQueryString(activeState, { limit: 24, page: 2 });
    assert.ok(customLimitUrl.includes('limit=24'), 'non-default limit 24 must be preserved');
    assert.ok(customLimitUrl.includes('page=2'));
});

test('Issue #9: internships.ejs renders pagination controls, indicators and accessible elements', () => {
    const mockInternships = Array.from({ length: 12 }, (_, i) => ({
        _id: '507f1f77bcf86cd7994390' + (i + 10),
        title: `Software Intern ${i + 1}`,
        company: 'Tech Corp',
        companyName: 'Tech Corp',
        sector: 'Technology',
        location: { district: 'Bengaluru', state: 'Karnataka' },
        monthlyStipend: 15000,
        duration: '6 Months',
        requiredSkills: ['JavaScript', 'React'],
        vacancies: 3,
        status: 'published'
    }));

    const paginationData = buildPaginationData(30, 2, 12);
    const queryState = { search: 'software', sector: 'Technology', page: 2, limit: 12 };

    const html = ejs.render(internshipsTemplate, {
        layout: () => undefined,
        currentUser: null,
        candidate: null,
        internships: mockInternships,
        queryState,
        currentFilter: 'all',
        pagination: paginationData,
        paginationData,
        sectors: ['Technology'],
        skillOptions: ['JavaScript', 'React'],
        durationBuckets: [],
        activeFilters: [],
        clearFiltersUrl: '/internships',
        appliedIds: [],
        buildQueryString
    }, { filename: internshipsViewPath });

    
    assert.ok(html.includes('Showing 13–24 of 30 Opportunities'), 'top count indicator must show current item range and total');

    
    assert.ok(html.includes('aria-label="Internship listings pagination"'), 'must include semantic accessible nav');
    assert.ok(html.includes('Showing <strong class="font-bold text-slate-900">13</strong> to <strong class="font-bold text-slate-900">24</strong> of <strong class="font-bold text-slate-900">30</strong> opportunities'), 'must show item range summary');
    assert.ok(html.includes('Page <strong class="font-bold text-slate-900">2</strong> of <strong class="font-bold text-slate-900">3</strong>'), 'must show page indicators');

    
    assert.ok(html.includes('Previous'), 'must have previous control');
    assert.ok(html.includes('Next'), 'must have next control');
    assert.ok(html.includes('aria-current="page"'), 'active page 2 must have aria-current="page"');

    
    assert.ok(html.includes('search=software'), 'page link must preserve search filter');
    assert.ok(html.includes('sector=Technology'), 'page link must preserve sector filter');
});
