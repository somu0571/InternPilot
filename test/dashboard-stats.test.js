const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeOverview, isActiveListing, DEADLINE_WINDOW_DAYS } = require('../utils/dashboardStats');

const NOW = new Date('2026-09-25T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const inDays = (n) => new Date(NOW.getTime() + n * DAY_MS);

test('empty company returns zeros instead of crashing', () => {
    const result = summarizeOverview({ now: NOW });
    assert.deepEqual(result.metrics, {
        activeInternships: 0,
        totalApplications: 0,
        shortlisted: 0,
        scheduledInterviews: 0,
        selected: 0,
        closingSoon: 0
    });
    assert.deepEqual(result.pipeline, []);
    assert.deepEqual(result.closingSoon, []);
    assert.equal(result.openSeatsClosingSoon, 0);
});

test('isActiveListing only counts listings open to applicants', () => {
    assert.equal(isActiveListing({ status: 'published' }), true);
    assert.equal(isActiveListing({}), true, 'legacy listings with no status are published');
    assert.equal(isActiveListing({ status: 'draft' }), false);
    assert.equal(isActiveListing({ status: 'paused' }), false);
    assert.equal(isActiveListing({ status: 'closed' }), false);
    assert.equal(isActiveListing({ status: 'published', vacancies: 1, filledSeats: 1 }), false);
    assert.equal(isActiveListing({ status: 'published', isPaused: true }), false);
});

test('active internship count ignores drafts, paused and closed listings', () => {
    const { metrics } = summarizeOverview({
        now: NOW,
        internships: [
            { _id: 1, status: 'published' },
            { _id: 2 },
            { _id: 3, status: 'draft' },
            { _id: 4, status: 'paused' },
            { _id: 5, status: 'published', isPaused: true },
            { _id: 6, status: 'closed' }
        ]
    });
    assert.equal(metrics.activeInternships, 2);
});

test('application metrics come from the status breakdown', () => {
    const { metrics } = summarizeOverview({
        now: NOW,
        statusCounts: [
            { _id: 'Submitted', count: 10 },
            { _id: 'Shortlisted', count: 4 },
            { _id: 'Interview', count: 3 },
            { _id: 'Hired', count: 2 },
            { _id: 'Rejected', count: 1 }
        ],
        upcomingInterviews: 3
    });
    assert.equal(metrics.totalApplications, 20);
    assert.equal(metrics.shortlisted, 4);
    assert.equal(metrics.selected, 2);
    assert.equal(metrics.scheduledInterviews, 3);
});

test('legacy "pending" status is folded into Submitted', () => {
    const { pipeline, metrics } = summarizeOverview({
        now: NOW,
        statusCounts: [
            { _id: 'pending', count: 3 },
            { _id: 'Submitted', count: 2 }
        ]
    });
    assert.equal(metrics.totalApplications, 5);
    assert.deepEqual(pipeline, [{ stage: 'Submitted', count: 5, percent: 100 }]);
});

test('pipeline keeps stage order and drops empty stages', () => {
    const { pipeline } = summarizeOverview({
        now: NOW,
        statusCounts: [
            { _id: 'Hired', count: 1 },
            { _id: 'Submitted', count: 3 }
        ]
    });
    assert.deepEqual(pipeline.map(p => p.stage), ['Submitted', 'Hired']);
    assert.deepEqual(pipeline.map(p => p.percent), [75, 25]);
});

test('closing soon includes only active listings due inside the window', () => {
    const { closingSoon, metrics } = summarizeOverview({
        now: NOW,
        internships: [
            { _id: 'a', title: 'Due in 3 days', applicationDeadline: inDays(3), vacancies: 2 },
            { _id: 'b', title: 'Due in 1 day', applicationDeadline: inDays(1), vacancies: 1 },
            { _id: 'c', title: 'Already passed', applicationDeadline: inDays(-1) },
            { _id: 'd', title: 'Too far out', applicationDeadline: inDays(DEADLINE_WINDOW_DAYS + 1) },
            { _id: 'e', title: 'Draft due soon', status: 'draft', applicationDeadline: inDays(2) },
            { _id: 'f', title: 'Paused due soon', status: 'paused', applicationDeadline: inDays(2) },
            { _id: 'g', title: 'No deadline' }
        ]
    });

    assert.equal(metrics.closingSoon, 2);
    assert.deepEqual(closingSoon.map(i => i.title), ['Due in 1 day', 'Due in 3 days'], 'soonest first');
    assert.deepEqual(closingSoon.map(i => i.daysLeft), [1, 3]);
});

test('closing soon list is capped at 5 but seat total counts every listing', () => {
    const internships = Array.from({ length: 7 }, (_, n) => ({
        _id: n,
        title: 'Role ' + n,
        applicationDeadline: inDays(1 + (n % 5)),
        vacancies: 2
    }));
    const result = summarizeOverview({ now: NOW, internships });

    assert.equal(result.metrics.closingSoon, 7);
    assert.equal(result.closingSoon.length, 5);
    assert.equal(result.openSeatsClosingSoon, 14);
});

test('missing title and vacancies fall back to safe defaults', () => {
    const { closingSoon } = summarizeOverview({
        now: NOW,
        internships: [{ _id: 'x', applicationDeadline: inDays(2) }]
    });
    assert.equal(closingSoon[0].title, 'Untitled listing');
    assert.equal(closingSoon[0].vacancies, 1);
});
