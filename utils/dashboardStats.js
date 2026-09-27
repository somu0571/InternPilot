const Internship = require('../models/Internship');
const Application = require('../models/Application');

const DEADLINE_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// Order the pipeline bar is drawn in. 'pending' is a legacy value from before
// the status enum was expanded and means the same thing as 'Submitted'.
const PIPELINE_STAGES = ['Submitted', 'Under Review', 'Shortlisted', 'Interview', 'Hired', 'Offer Declined', 'Rejected', 'Withdrawn'];
const STATUS_ALIASES = { pending: 'Submitted' };

const ACTIVE_INTERVIEW_STATES = ['Scheduled', 'Rescheduled'];

/**
 * Whether a listing is currently open to new applicants.
 *
 * Listings created before the status field existed have no status at all, so
 * a missing status counts as published unless the listing is paused.
 *
 * @param {{status?: string, isPaused?: boolean}} internship
 * @returns {boolean}
 */
function isActiveListing(internship) {
    const status = internship.status || 'published';
    const capacity = Number(internship.vacancies) > 0 ? Number(internship.vacancies) : 1;
    return status === 'published'
        && internship.isPaused !== true
        && Number(internship.filledSeats || 0) < capacity;
}

/**
 * Turns raw query results into the numbers the overview renders.
 *
 * Kept free of database calls so it can be tested with plain objects.
 *
 * @param {object} input
 * @param {Array<{_id: *, title?: string, status?: string, isPaused?: boolean,
 *   applicationDeadline?: Date, vacancies?: number}>} input.internships
 *   Every listing owned by the company, drafts included.
 * @param {Array<{_id: string, count: number}>} input.statusCounts
 *   Application counts grouped by status.
 * @param {number} input.upcomingInterviews Interviews still ahead of `now`.
 * @param {Date} [input.now] Reference time, injectable for tests.
 * @returns {object} Metrics, pipeline segments and the deadline list.
 */
function summarizeOverview({ internships = [], statusCounts = [], upcomingInterviews = 0, now = new Date() }) {
    const byStatus = {};
    statusCounts.forEach(({ _id, count }) => {
        const stage = STATUS_ALIASES[_id] || _id;
        if (!stage) return;
        byStatus[stage] = (byStatus[stage] || 0) + count;
    });

    const totalApplications = Object.values(byStatus).reduce((sum, n) => sum + n, 0);

    const pipeline = PIPELINE_STAGES
        .map(stage => ({
            stage,
            count: byStatus[stage] || 0,
            percent: totalApplications ? Math.round(((byStatus[stage] || 0) / totalApplications) * 100) : 0
        }))
        .filter(segment => segment.count > 0);

    const activeListings = internships.filter(isActiveListing);
    const windowEnd = now.getTime() + DEADLINE_WINDOW_DAYS * DAY_MS;

    const closingSoon = activeListings
        .filter(i => {
            if (!i.applicationDeadline) return false;
            const deadline = new Date(i.applicationDeadline).getTime();
            return deadline >= now.getTime() && deadline <= windowEnd;
        })
        .map(i => {
            const deadline = new Date(i.applicationDeadline);
            return {
                id: String(i._id),
                title: i.title || 'Untitled listing',
                deadline: deadline.toISOString(),
                vacancies: i.vacancies || 1,
                daysLeft: Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / DAY_MS))
            };
        })
        .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

    return {
        metrics: {
            activeInternships: activeListings.length,
            totalApplications,
            shortlisted: byStatus.Shortlisted || 0,
            scheduledInterviews: upcomingInterviews,
            selected: byStatus.Hired || 0,
            closingSoon: closingSoon.length
        },
        pipeline,
        closingSoon: closingSoon.slice(0, 5),
        openSeatsClosingSoon: closingSoon.reduce((sum, i) => sum + i.vacancies, 0),
        deadlineWindowDays: DEADLINE_WINDOW_DAYS,
        generatedAt: now.toISOString()
    };
}

/**
 * Loads everything the recruiter overview needs for one company.
 *
 * Three queries, run in parallel: the company's listings, an aggregate of
 * application statuses, and a count of interviews that have not happened yet.
 *
 * @param {*} companyId The company whose listings are summarised.
 * @param {Date} [now] Reference time, injectable for tests.
 * @returns {Promise<object>} See {@link summarizeOverview}.
 */
async function buildRecruiterOverview(companyId, now = new Date()) {
    if (!companyId) return summarizeOverview({ now });

    const internships = await Internship.find({ companyId })
        .select('title status isPaused applicationDeadline vacancies')
        .lean();

    const ids = internships.map(i => i._id);
    if (!ids.length) return summarizeOverview({ internships, now });

    const [statusCounts, upcomingInterviews] = await Promise.all([
        Application.aggregate([
            { $match: { internship: { $in: ids } } },
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ]),
        Application.countDocuments({
            internship: { $in: ids },
            'interview.status': { $in: ACTIVE_INTERVIEW_STATES },
            'interview.scheduledAt': { $gte: now }
        })
    ]);

    return summarizeOverview({ internships, statusCounts, upcomingInterviews, now });
}

module.exports = {
    buildRecruiterOverview,
    summarizeOverview,
    isActiveListing,
    DEADLINE_WINDOW_DAYS
};
