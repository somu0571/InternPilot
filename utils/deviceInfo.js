const crypto = require('crypto');

// Just enough user-agent reading to label a signed-in session for its owner,
// for example "Chrome on Android". No version numbers are kept, so a browser
// update doesn't make a device look new.

const BROWSERS = [
    [/EdgA?\/|Edg\//, 'Edge'],
    [/SamsungBrowser\//, 'Samsung Internet'],
    [/OPR\/|Opera/, 'Opera'],
    [/Firefox\/|FxiOS\//, 'Firefox'],
    [/CriOS\//, 'Chrome'],
    [/Chrome\/|Chromium\//, 'Chrome'],
    [/Version\/[\d.]+.*Safari\//, 'Safari']
];

const OPERATING_SYSTEMS = [
    [/Android/, 'Android'],
    [/iPad/, 'iPadOS'],
    [/iPhone|iPod/, 'iOS'],
    [/Windows NT/, 'Windows'],
    [/CrOS/, 'ChromeOS'],
    [/Macintosh|Mac OS X/, 'macOS'],
    [/Linux/, 'Linux']
];

function firstMatch(list, value, fallback) {
    const found = list.find(([pattern]) => pattern.test(value));
    return found ? found[1] : fallback;
}

/** { browser, os, deviceType } from a User-Agent header. */
function parseUserAgent(userAgent) {
    const ua = String(userAgent || '');
    const os = firstMatch(OPERATING_SYSTEMS, ua, 'Unknown OS');
    let deviceType = 'desktop';
    if (/iPad|Tablet/i.test(ua) || (os === 'Android' && !/Mobile/.test(ua))) deviceType = 'tablet';
    else if (/Mobi|iPhone|iPod/.test(ua)) deviceType = 'phone';
    return { browser: firstMatch(BROWSERS, ua, 'Unknown browser'), os, deviceType };
}

/** Only the network part of the address is kept: 103.87.59.x, or the first three IPv6 groups. */
function maskIp(ip) {
    const value = String(ip || '').trim().replace(/^::ffff:/i, '');
    if (!value) return 'unknown';
    const v4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
    if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.x`;
    if (value.includes(':')) {
        const groups = value.split(':').filter(Boolean).slice(0, 3);
        return groups.length ? `${groups.join(':')}::` : 'unknown';
    }
    return 'unknown';
}

/** What we store about a sign-in: browser, OS, device type, masked IP and when. */
function describeDevice(userAgent, ip, signedInAt = new Date()) {
    return { ...parseUserAgent(userAgent), ip: maskIp(ip), signedInAt: new Date(signedInAt).toISOString() };
}

function deviceLabel(device) {
    if (!device) return 'Unknown device';
    return `${device.browser || 'Unknown browser'} on ${device.os || 'Unknown OS'}`;
}

/** Same browser, OS and device type count as the same device. */
function deviceFingerprint(device) {
    return [device && device.browser, device && device.os, device && device.deviceType].join('|');
}

/**
 * A short fingerprint of the stored password hash. Kept in the session at
 * sign-in; if it no longer matches, the password was changed since, and the
 * session is signed out. Accounts without a password (Google sign-in) get null.
 */
function passwordStamp(user) {
    if (!user || !user.password) return null;
    return crypto.createHash('sha256').update(String(user.password)).digest('hex').slice(0, 16);
}

module.exports = { parseUserAgent, maskIp, describeDevice, deviceLabel, deviceFingerprint, passwordStamp };
