const Notification = require('../models/Notification');
const User = require('../models/User');
const Internship = require('../models/Internship');
const Application = require('../models/Application');
const SavedSearch = require('../models/SavedSearch');
const SavedSearchAlertDelivery = require('../models/SavedSearchAlertDelivery');
const { randomUUID } = require('crypto');
const { skillNames } = require('./skillProfiles');
const {
    matchesInternshipCriteria,
    buildSavedSearchResultsUrl
} = require('./queryHelper');
const { sendSavedSearchAlertEmail, sendCertificateIssuedEmail } = require('./sendEmail');

const INSTANT_EMAIL_CONCURRENCY = 5;
const INSTANT_EMAIL_LEASE_MS = 15 * 60 * 1000;

function isDuplicateKeyError(error) {
    return error?.code === 11000 || error?.codeName === 'DuplicateKey';
}

/**
 * Runs asynchronous work with a small, explicit concurrency bound. SMTP
 * providers throttle bursts aggressively; unbounded Promise.all can turn one
 * popular listing into hundreds of simultaneous connection attempts.
 */
async function mapWithConcurrency(items, limit, worker) {
    const input = Array.isArray(items) ? items : [];
    if (!input.length) return [];

    const results = new Array(input.length);
    const workerCount = Math.min(Math.max(1, limit || 1), input.length);
    let nextIndex = 0;

    async function runWorker() {
        while (nextIndex < input.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await worker(input[index], index);
        }
    }

    await Promise.all(Array.from({ length: workerCount }, runWorker));
    return results;
}

/**
 * Atomically claims one candidate/listing e-mail. A sent record is permanent;
 * a short lease lets a later job recover if the process dies while SMTP work
 * is in flight. A duplicate-key result simply means another worker owns it.
 */
async function claimInstantEmailDelivery(candidateId, internshipId, now = new Date()) {
    if (!candidateId || !internshipId) return null;

    const claimToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + INSTANT_EMAIL_LEASE_MS);
    try {
        return await SavedSearchAlertDelivery.findOneAndUpdate(
            {
                candidate: candidateId,
                internship: internshipId,
                channel: 'instant_email',
                $or: [
                    { status: { $exists: false } },
                    { status: 'sending', leaseExpiresAt: { $lte: now } }
                ]
            },
            {
                $set: {
                    status: 'sending',
                    claimToken,
                    leaseExpiresAt
                },
                $setOnInsert: {
                    candidate: candidateId,
                    internship: internshipId,
                    channel: 'instant_email'
                }
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );
    } catch (error) {
        if (isDuplicateKeyError(error)) return null;
        throw error;
    }
}

async function markInstantEmailDelivered(claim, now = new Date()) {
    if (!claim?._id || !claim.claimToken) return;
    await SavedSearchAlertDelivery.updateOne(
        { _id: claim._id, status: 'sending', claimToken: claim.claimToken },
        {
            $set: { status: 'sent', sentAt: now },
            $unset: { leaseExpiresAt: 1 }
        }
    );
}

async function releaseInstantEmailClaim(claim) {
    if (!claim?._id || !claim.claimToken) return;
    try {
        await SavedSearchAlertDelivery.deleteOne({
            _id: claim._id,
            status: 'sending',
            claimToken: claim.claimToken
        });
    } catch (error) {
        // The lease still makes this recoverable if deletion itself fails.
        console.error('Failed to release saved-search e-mail delivery claim:', error.message);
    }
}

function normalise(value) {
    return (value || '').trim().toLowerCase();
}

function hasLocationMatch(candidate, internship) {
    const candidateDistrict = normalise(candidate.location?.district);
    const candidateState = normalise(candidate.location?.state);
    const internshipDistrict = normalise(internship.location?.district);
    const internshipState = normalise(internship.location?.state);

    // Do not exclude candidates with incomplete profiles. When both sides
    // contain a location, a district match is preferred, then a state match.
    if ((!candidateDistrict && !candidateState) || (!internshipDistrict && !internshipState)) {
        return true;
    }

    if (candidateDistrict && internshipDistrict) {
        return candidateDistrict === internshipDistrict;
    }

    return !candidateState || !internshipState || candidateState === internshipState;
}

function hasQualificationMatch(candidate, internship) {
    const requirement = normalise(internship.minQualifications);
    const qualification = normalise(candidate.education?.qualification);

    if (!requirement || requirement === 'any' || !qualification) return true;
    return requirement.includes(qualification) || qualification.includes(requirement);
}

function hasSkillMatch(candidate, internship) {
    const requiredSkills = (internship.requiredSkills || []).map(normalise).filter(Boolean);
    if (!requiredSkills.length) return true;

    const candidateSkills = new Set(skillNames(candidate).map(normalise).filter(Boolean));
    return requiredSkills.some(skill => candidateSkills.has(skill));
}

function isRelevantInternship(candidate, internship) {
    return hasSkillMatch(candidate, internship)
        && hasLocationMatch(candidate, internship)
        && hasQualificationMatch(candidate, internship);
}

function isOpenPublishedInternship(internship, now = new Date()) {
    if (!internship || internship.status !== 'published' || internship.isPaused === true) return false;
    if (!internship.applicationDeadline) return true;
    const deadline = new Date(internship.applicationDeadline);
    return Number.isNaN(deadline.getTime()) || deadline.getTime() >= now.getTime();
}

function identifier(value) {
    return value && value._id ? String(value._id) : String(value || '');
}

function addSavedSearchMatch(groups, candidate, savedSearch) {
    const key = identifier(candidate);
    if (!key) return;
    const group = groups.get(key) || { candidate, matches: [] };
    group.matches.push(savedSearch);
    groups.set(key, group);
}

async function notifyRelevantCandidates(internship) {
    const now = new Date();
    // A draft, closed, paused, or expired listing must never produce an alert.
    if (!isOpenPublishedInternship(internship, now)) return 0;

    const [candidates, savedSearches] = await Promise.all([
        User.find({ role: 'candidate', isEmailVerified: true, isActive: true })
            .select('_id name email skills skillProfiles location education')
            .lean(),
        SavedSearch.find({ isPaused: false, frequency: { $ne: 'off' } }).lean()
    ]);

    const candidatesById = new Map(candidates.map(candidate => [identifier(candidate), candidate]));
    const profileMatches = new Set(
        candidates.filter(candidate => isRelevantInternship(candidate, internship)).map(identifier)
    );
    const savedMatchesByCandidate = new Map();

    savedSearches.forEach(savedSearch => {
        const candidate = candidatesById.get(identifier(savedSearch.candidate));
        if (!candidate || !matchesInternshipCriteria(internship, savedSearch.criteria, now)) return;
        addSavedSearchMatch(savedMatchesByCandidate, candidate, savedSearch);
    });

    // Group by candidate so profile matching and multiple saved searches never
    // produce duplicate in-app notifications for one published listing.
    const immediateRecipients = new Map();
    profileMatches.forEach(candidateId => {
        const candidate = candidatesById.get(candidateId);
        if (candidate) immediateRecipients.set(candidateId, { candidate, savedMatches: [], profileMatch: true });
    });

    const inAppSavedSearchIds = [];
    savedMatchesByCandidate.forEach((group, candidateId) => {
        const instantInAppMatches = group.matches.filter(search =>
            search.frequency === 'instant' && search.delivery?.inApp !== false
        );
        if (!instantInAppMatches.length) return;

        const recipient = immediateRecipients.get(candidateId) || {
            candidate: group.candidate,
            savedMatches: [],
            profileMatch: false
        };
        recipient.savedMatches.push(...instantInAppMatches);
        immediateRecipients.set(candidateId, recipient);
        inAppSavedSearchIds.push(...instantInAppMatches.map(search => search._id));
    });

    if (immediateRecipients.size) {
        const operations = [...immediateRecipients.values()].map(({ candidate, savedMatches, profileMatch }) => {
            const savedNames = [...new Set(savedMatches.map(search => search.name).filter(Boolean))];
            const matchMessage = profileMatch
                ? `${internship.title} at ${internship.companyName} matches your profile.`
                : `${internship.title} at ${internship.companyName} matches your saved search${savedNames.length === 1 ? ` “${savedNames[0]}”` : 'es'}.`;

            return {
                updateOne: {
                    filter: {
                        recipient: candidate._id,
                        internship: internship._id,
                        type: 'new_matching_internship'
                    },
                    update: {
                        $setOnInsert: {
                            recipient: candidate._id,
                            type: 'new_matching_internship',
                            title: 'New internship match',
                            message: matchMessage,
                            link: savedMatches.length ? buildSavedSearchResultsUrl(savedMatches[0].criteria) : '/internships',
                            internship: internship._id,
                            isRead: false
                        }
                    },
                    upsert: true
                }
            };
        });

        await Notification.bulkWrite(operations, { ordered: false });
    }

    // Email-only and "both" instant alerts are sent once per candidate/listing
    // even when more than one saved search matches. The durable claim both
    // prevents duplicates after a resume/retry and bounds SMTP pressure.
    const emailResults = await mapWithConcurrency(
        [...savedMatchesByCandidate.values()],
        INSTANT_EMAIL_CONCURRENCY,
        async group => {
            const matchingSearches = group.matches.filter(search =>
                search.frequency === 'instant' && search.delivery?.email === true
            );
            if (!matchingSearches.length || !group.candidate.email) {
                return { candidateId: identifier(group.candidate), searchIds: [], delivered: false };
            }

            let claim = null;
            try {
                claim = await claimInstantEmailDelivery(group.candidate._id, internship._id, now);
                if (!claim) {
                    return { candidateId: identifier(group.candidate), searchIds: [], delivered: false };
                }

                await sendSavedSearchAlertEmail(
                    group.candidate.email,
                    group.candidate.name,
                    matchingSearches.map(search => search.name),
                    [internship],
                    'instant',
                    buildSavedSearchResultsUrl(matchingSearches[0].criteria)
                );
                await markInstantEmailDelivered(claim, now);
                return {
                    candidateId: identifier(group.candidate),
                    searchIds: matchingSearches.map(search => search._id),
                    delivered: true
                };
            } catch (error) {
                // E-mail delivery must not make publishing an internship fail;
                // deleting this token allows a later publish/job to retry it.
                await releaseInstantEmailClaim(claim);
                console.error('Failed to send saved-search instant alert:', error.message);
                return { candidateId: identifier(group.candidate), searchIds: [], delivered: false };
            }
        }
    );
    const emailSearchIds = emailResults.flatMap(result => result.searchIds || []);

    const deliveredSearchIds = [...new Set([...inAppSavedSearchIds, ...emailSearchIds].map(identifier).filter(Boolean))];
    if (deliveredSearchIds.length) {
        await SavedSearch.updateMany(
            { _id: { $in: deliveredSearchIds } },
            { $set: { lastAlertAt: now } }
        );
    }

    const alertedCandidateIds = new Set([
        ...immediateRecipients.keys(),
        ...emailResults.filter(result => result.delivered).map(result => result.candidateId)
    ]);
    return alertedCandidateIds.size;
}

function publicationTimestampFromInternship(internship) {
    if (internship?.publishedAt) {
        const value = new Date(internship.publishedAt);
        if (!Number.isNaN(value.getTime())) return value;
    }

    // Legacy listings predate publishedAt. Their original creation time is
    // the best available fallback; all new publish/resume transitions write
    // a real publication timestamp in the Internship model.
    if (internship?.createdAt) {
        const value = new Date(internship.createdAt);
        if (!Number.isNaN(value.getTime())) return value;
    }
    if (internship?._id && typeof internship._id.getTimestamp === 'function') return internship._id.getTimestamp();
    return null;
}

function digestKey(frequency, now) {
    const date = new Date(now);
    return `${frequency}:${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function digestPayload(entries) {
    const searchNames = [...new Set(entries.map(entry => entry.savedSearch.name).filter(Boolean))];
    const internships = [...new Map(
        entries.flatMap(entry => entry.matches).map(internship => [identifier(internship), internship])
    ).values()];
    return { searchNames, internships };
}

// A digest can contain matches from more than one saved search. Use the first
// matching search as its destination instead of sending candidates to the
// generic saved-search management page. This keeps the alert actionable: the
// result page opens with the same filters that produced the match.
function digestResultsPath(entries) {
    const entry = (Array.isArray(entries) ? entries : []).find(item => item?.savedSearch?.criteria);
    return entry
        ? buildSavedSearchResultsUrl(entry.savedSearch.criteria)
        : '/internships?status=active';
}

function shouldAdvanceDigestCheckpoint(savedSearch, { hasMatches, inAppDelivered, emailDelivered }) {
    if (!hasMatches) return true;

    const wantsInApp = savedSearch.delivery?.inApp !== false;
    const wantsEmail = savedSearch.delivery?.email === true;
    return (wantsInApp && inAppDelivered) || (wantsEmail && emailDelivered);
}

/**
 * Delivers a candidate-level digest for daily or weekly saved searches. It is
 * exported so scheduler behavior can be exercised without waiting for cron.
 *
 * @param {'daily'|'weekly'} frequency
 * @param {Date} [now]
 * @returns {Promise<number>} number of candidate digests created
 */
async function runSavedSearchDigests(frequency, now = new Date()) {
    if (!['daily', 'weekly'].includes(frequency)) return 0;

    const [savedSearches, internships] = await Promise.all([
        SavedSearch.find({ frequency, isPaused: false }).lean(),
        Internship.find({
            status: 'published',
            isPaused: { $ne: true },
            $or: [
                { applicationDeadline: { $exists: false } },
                { applicationDeadline: null },
                { applicationDeadline: { $gte: now } }
            ]
        }).lean()
    ]);
    if (!savedSearches.length) return 0;

    const candidateIds = [...new Set(savedSearches.map(search => identifier(search.candidate)).filter(Boolean))];
    const candidates = await User.find({
        _id: { $in: candidateIds },
        role: 'candidate',
        isEmailVerified: true,
        isActive: true
    }).select('_id name email').lean();
    const candidatesById = new Map(candidates.map(candidate => [identifier(candidate), candidate]));
    const allInternshipIds = internships.map(internship => internship._id);
    const applications = allInternshipIds.length
        ? await Application.find({
            candidate: { $in: candidateIds },
            internship: { $in: allInternshipIds }
        }).select('candidate internship').lean()
        : [];
    const appliedByCandidate = new Map();
    applications.forEach(application => {
        const candidateId = identifier(application.candidate);
        const applied = appliedByCandidate.get(candidateId) || new Set();
        applied.add(identifier(application.internship));
        appliedByCandidate.set(candidateId, applied);
    });

    const grouped = new Map();
    const checkpointIds = new Set();
    savedSearches.forEach(savedSearch => {
        const candidate = candidatesById.get(identifier(savedSearch.candidate));
        if (!candidate) return;
        const since = new Date(savedSearch.lastDigestAt || savedSearch.alertStartAt || savedSearch.createdAt || now);
        const safeSince = Number.isNaN(since.getTime()) ? now : since;
        const alreadyApplied = appliedByCandidate.get(identifier(candidate)) || new Set();
        const matches = internships.filter(internship => {
            const publishedAt = publicationTimestampFromInternship(internship);
            return publishedAt && publishedAt.getTime() > safeSince.getTime()
                && !alreadyApplied.has(identifier(internship))
                && matchesInternshipCriteria(internship, savedSearch.criteria, now);
        });
        if (!matches.length) {
            // A digest window with no matching listing is safe to advance.
            checkpointIds.add(identifier(savedSearch._id));
            return;
        }

        const candidateId = identifier(candidate);
        const entry = grouped.get(candidateId) || { candidate, searches: [] };
        entry.searches.push({ savedSearch, matches });
        grouped.set(candidateId, entry);
    });

    let delivered = 0;
    for (const { candidate, searches } of grouped.values()) {
        const inAppEntries = searches.filter(entry => entry.savedSearch.delivery?.inApp !== false);
        const emailEntries = searches.filter(entry => entry.savedSearch.delivery?.email === true);
        const key = digestKey(frequency, now);
        let inAppDelivered = false;
        let emailDelivered = false;

        if (inAppEntries.length) {
            const { searchNames, internships: internshipsForDigest } = digestPayload(inAppEntries);
            const resultsPath = digestResultsPath(inAppEntries);
            const message = `${internshipsForDigest.length} new internship${internshipsForDigest.length === 1 ? '' : 's'} match your ${frequency} saved searches.`;
            try {
                await Notification.updateOne(
                    {
                        recipient: candidate._id,
                        type: 'saved_search_digest',
                        'metadata.digestKey': key
                    },
                    {
                        $setOnInsert: {
                            recipient: candidate._id,
                            type: 'saved_search_digest',
                            title: `${frequency[0].toUpperCase()}${frequency.slice(1)} internship matches`,
                            message,
                            link: resultsPath,
                            metadata: {
                                digestKey: key,
                                savedSearchId: inAppEntries[0].savedSearch._id,
                                internshipCount: internshipsForDigest.length,
                                searchNames
                            },
                            isRead: false
                        }
                    },
                    { upsert: true }
                );
                inAppDelivered = true;
            } catch (error) {
                // Another scheduler may have inserted the same daily/weekly
                // notification. In that case the candidate already has it.
                if (isDuplicateKeyError(error)) {
                    inAppDelivered = true;
                } else {
                    console.error('Failed to create saved-search in-app digest:', error.message);
                }
            }
        }

        if (emailEntries.length && candidate.email) {
            const { searchNames, internships: internshipsForDigest } = digestPayload(emailEntries);
            try {
                await sendSavedSearchAlertEmail(
                    candidate.email,
                    candidate.name,
                    searchNames,
                    internshipsForDigest,
                    frequency,
                    digestResultsPath(emailEntries)
                );
                emailDelivered = true;
            } catch (error) {
                console.error('Failed to send saved-search digest:', error.message);
            }
        }

        if (inAppDelivered || emailDelivered) delivered += 1;

        searches.forEach(({ savedSearch }) => {
            if (shouldAdvanceDigestCheckpoint(savedSearch, {
                hasMatches: true,
                inAppDelivered,
                emailDelivered
            })) {
                checkpointIds.add(identifier(savedSearch._id));
            }
        });
    }

    // Do not discard an e-mail-only search's window after an SMTP failure. A
    // no-match window, or one delivered through at least one chosen channel,
    // can advance safely. $max also protects overlapping scheduler runs.
    if (checkpointIds.size) {
        await SavedSearch.updateMany(
            { _id: { $in: [...checkpointIds] } },
            { $max: { lastDigestAt: now } }
        );
    }
    return delivered;
}

async function notifyApplicationStatusChange(application, internship, status) {
    const isShortlisted = status === 'Shortlisted';

    await Notification.create({
        recipient: application.candidate._id || application.candidate,
        type: isShortlisted ? 'application_shortlisted' : 'application_status',
        title: isShortlisted ? 'You have been shortlisted!' : 'Application status updated',
        message: isShortlisted
            ? `You have been shortlisted for ${internship.title} at ${internship.companyName}.`
            : `Your application for ${internship.title} at ${internship.companyName} is now ${status}.`,
        link: '/candidate/applications',
        internship: internship._id,
        application: application._id
    });
}

async function notifyInterviewScheduled(application, internship, dateString) {
    await Notification.create({
        recipient: application.candidate._id || application.candidate,
        type: 'interview_scheduled',
        title: 'Interview Scheduled',
        message: `An interview for ${internship.title} at ${internship.companyName} has been scheduled for ${dateString}.`,
        link: '/candidate/applications',
        internship: internship._id,
        application: application._id
    });
}

async function notifyInterviewRescheduled(application, internship, dateString) {
    await Notification.create({
        recipient: application.candidate._id || application.candidate,
        type: 'interview_rescheduled',
        title: 'Interview Rescheduled',
        message: `Your interview for ${internship.title} at ${internship.companyName} has been rescheduled to ${dateString}.`,
        link: '/candidate/applications',
        internship: internship._id,
        application: application._id
    });
}

async function notifyInterviewCancelled(application, internship) {
    await Notification.create({
        recipient: application.candidate._id || application.candidate,
        type: 'interview_cancelled',
        title: 'Interview Cancelled',
        message: `Your interview for ${internship.title} at ${internship.companyName} has been cancelled.`,
        link: '/candidate/applications',
        internship: internship._id,
        application: application._id
    });
}

async function notifyCertificateIssued(certificate) {
    if (!certificate || !certificate.candidate) return null;

    try {
        const title = 'Certificate of Completion Issued!';
        const message = `Congratulations! ${certificate.companyName || 'Your host company'} has issued your official Internship Certificate of Completion for ${certificate.internshipTitle}.`;
        const link = `/certificates/${certificate.certificateId}/view`;

        const notification = await Notification.create({
            recipient: certificate.candidate._id || certificate.candidate,
            type: 'certificate_issued',
            title,
            message,
            link,
            internship: certificate.internship?._id || certificate.internship,
            application: certificate.application?._id || certificate.application
        });

        const candidateEmail = certificate.candidateEmail || certificate.candidate?.email;
        if (candidateEmail && typeof sendCertificateIssuedEmail === 'function') {
            const baseUrl = process.env.APP_URL || 'http://localhost:5000';
            const viewUrl = `${baseUrl}${link}`;
            sendCertificateIssuedEmail(
                candidateEmail,
                certificate.candidateName,
                certificate.companyName,
                certificate.internshipTitle,
                certificate.certificateId,
                viewUrl
            ).catch(err => {
                console.error('Failed to send certificate email:', err.message);
            });
        }

        return notification;
    } catch (err) {
        console.error('Error in notifyCertificateIssued:', err);
        return null;
    }
}

module.exports = {
    isRelevantInternship,
    notifyRelevantCandidates,
    runSavedSearchDigests,
    // Exported small pure helpers keep scheduling and SMTP safeguards covered
    // without requiring a database or a real mail provider in tests.
    mapWithConcurrency,
    publicationTimestampFromInternship,
    shouldAdvanceDigestCheckpoint,
    digestResultsPath,
    notifyApplicationStatusChange,
    notifyInterviewScheduled,
    notifyInterviewRescheduled,
    notifyInterviewCancelled,
    notifyCertificateIssued
};
