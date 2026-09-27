const cron = require('node-cron');
const Internship = require('../models/Internship');
const Notification = require('../models/Notification');
const { parseISTEndOfDay } = require('./dateUtils');
const { runSavedSearchDigests } = require('./notifications');
const { expireDueOffers } = require('./offers');

const APPROACHING_DEADLINE_DAYS = parseInt(process.env.APPROACHING_DEADLINE_DAYS, 10) || 3;

/**
 * Scheduled job to check for approaching internship deadlines.
 * Runs at midnight every day.
 */
cron.schedule('0 0 * * *', async () => {
    try {
        console.log('[Scheduler] Running deadline checker...');
        
        // Use a timezone-safe boundary (e.g. 3 days from now)
        const now = new Date();
        
        // Exact target day in the future
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + APPROACHING_DEADLINE_DAYS);

        // Build start/end boundaries from the ISO date string to avoid
        // mutation hazards — setHours mutates the receiver in-place.
        const isoDate = targetDate.toISOString().slice(0, 10); // YYYY-MM-DD
        const startOfTarget = new Date(`${isoDate}T00:00:00.000Z`);
        const endOfTarget = new Date(`${isoDate}T23:59:59.999Z`);

        const upcomingDeadlines = await Internship.find({
            status: 'published',
            isPaused: { $ne: true },
            applicationDeadline: {
                $gte: startOfTarget,
                $lte: endOfTarget
            }
        });

        if (upcomingDeadlines.length === 0) return;

        const operations = upcomingDeadlines.map(internship => {
            if (!internship.companyId) return null;
            
            return {
                updateOne: {
                    filter: {
                        companyId: internship.companyId,
                        internship: internship._id,
                        type: 'approaching_deadline'
                    },
                    update: {
                        $setOnInsert: {
                            companyId: internship.companyId,
                            type: 'approaching_deadline',
                            title: 'Deadline Approaching',
                            message: `The deadline for ${internship.title} is approaching in ${APPROACHING_DEADLINE_DAYS} days.`,
                            link: `/company/dashboard`,
                            internship: internship._id,
                            isRead: false
                        }
                    },
                    upsert: true
                }
            };
        }).filter(Boolean);

        if (operations.length > 0) {
            await Notification.bulkWrite(operations, { ordered: false });
        }
        
    } catch (error) {
        console.error('[Scheduler] Error checking deadlines:', error);
    }
});

// Saved-search digests run after the morning listing refresh in India. Instant
// alerts are emitted from the publish paths; these jobs are only for users who
// explicitly selected Daily or Weekly delivery.
cron.schedule('0 9 * * *', async () => {
    try {
        await runSavedSearchDigests('daily');
    } catch (error) {
        console.error('[Scheduler] Error delivering daily saved-search digests:', error);
    }
}, { timezone: 'Asia/Kolkata' });

cron.schedule('0 9 * * 1', async () => {
    try {
        await runSavedSearchDigests('weekly');
    } catch (error) {
        console.error('[Scheduler] Error delivering weekly saved-search digests:', error);
    }
}, { timezone: 'Asia/Kolkata' });

// Offer expiry is also checked when a candidate opens or responds to an offer.
// This lightweight sweep makes the final state and notifications timely even
// when neither party revisits the offer page.
cron.schedule('*/5 * * * *', async () => {
    try {
        await expireDueOffers();
    } catch (error) {
        console.error('[Scheduler] Error expiring internship offers:', error);
    }
});

module.exports = { runSavedSearchDigests, expireDueOffers };
