const DEFAULT_LOCALE = 'en-IN';
const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

function asValidDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatRelativeTime(value, now = new Date(), locale = DEFAULT_LOCALE) {
    const date = asValidDate(value);
    const currentTime = asValidDate(now);
    if (!date || !currentTime) return '';

    const elapsedMilliseconds = currentTime.getTime() - date.getTime();
    const elapsedSeconds = Math.max(0, Math.floor(elapsedMilliseconds / 1000));
    const relativeTime = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

    if (elapsedSeconds < 60) return 'just now';
    if (elapsedSeconds < 60 * 60) return relativeTime.format(-Math.floor(elapsedSeconds / 60), 'minute');
    if (elapsedSeconds < 24 * 60 * 60) return relativeTime.format(-Math.floor(elapsedSeconds / (60 * 60)), 'hour');
    if (elapsedSeconds < 7 * 24 * 60 * 60) return relativeTime.format(-Math.floor(elapsedSeconds / (24 * 60 * 60)), 'day');
    if (elapsedSeconds < 30 * 24 * 60 * 60) return relativeTime.format(-Math.floor(elapsedSeconds / (7 * 24 * 60 * 60)), 'week');
    if (elapsedSeconds < 365 * 24 * 60 * 60) return relativeTime.format(-Math.floor(elapsedSeconds / (30 * 24 * 60 * 60)), 'month');
    return relativeTime.format(-Math.floor(elapsedSeconds / (365 * 24 * 60 * 60)), 'year');
}

function formatLocalizedDateTime(value, locale = DEFAULT_LOCALE, timeZone = DEFAULT_TIME_ZONE) {
    const date = asValidDate(value);
    if (!date) return '';

    return new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone
    }).format(date);
}

/**
 * Calculates deadline urgency and returns presentation metadata for UI badges.
 * @param {Date|string|number} deadline - The application deadline.
 * @param {Date|string|number} [now=new Date()] - Reference time for calculation.
 * @param {string} [locale=DEFAULT_LOCALE] - Locale for formatting.
 * @param {string} [timeZone=DEFAULT_TIME_ZONE] - TimeZone for formatting.
 * @returns {object|null} Urgency metadata object or null if deadline is invalid/missing.
 */
function formatDeadlineUrgency(deadline, now = new Date(), locale = DEFAULT_LOCALE, timeZone = DEFAULT_TIME_ZONE) {
    const deadlineDate = asValidDate(deadline);
    const currentDate = asValidDate(now);
    if (!deadlineDate || !currentDate) return null;

    const diffMs = deadlineDate.getTime() - currentDate.getTime();
    const formattedDate = new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone
    }).format(deadlineDate);

    if (diffMs <= 0) {
        return {
            label: 'Application Closed',
            urgency: 'closed',
            isClosed: true,
            daysLeft: 0,
            formattedDate,
            badgeClass: 'bg-rose-100 text-rose-800 border-rose-300',
            icon: 'ph-bold ph-x-circle'
        };
    }

    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
        return {
            label: 'Closing in 1 day',
            urgency: 'critical',
            isClosed: false,
            daysLeft: 1,
            formattedDate,
            badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
            icon: 'ph-bold ph-warning'
        };
    }

    if (diffDays <= 3) {
        return {
            label: `Closing in ${diffDays} days`,
            urgency: 'warning',
            isClosed: false,
            daysLeft: diffDays,
            formattedDate,
            badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
            icon: 'ph-bold ph-hourglass-medium'
        };
    }

    if (diffDays <= 7) {
        return {
            label: `Closing in ${diffDays} days`,
            urgency: 'soon',
            isClosed: false,
            daysLeft: diffDays,
            formattedDate,
            badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
            icon: 'ph-bold ph-clock'
        };
    }

    return {
        label: `${diffDays} days left`,
        urgency: 'normal',
        isClosed: false,
        daysLeft: diffDays,
        formattedDate,
        badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        icon: 'ph-bold ph-calendar-check'
    };
}

module.exports = {
    asValidDate,
    formatRelativeTime,
    formatLocalizedDateTime,
    formatDeadlineUrgency
};

