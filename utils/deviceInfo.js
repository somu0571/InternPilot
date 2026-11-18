const crypto = require('crypto');





const BROWSERS = [
    [/EdgA?\/|Edg\
    [/SamsungBrowser\
    [/OPR\/|Opera/, 'Opera'],
    [/Firefox\/|FxiOS\
    [/CriOS\
    [/Chrome\/|Chromium\
    [/Version\/[\d.]+.*Safari\
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


function parseUserAgent(userAgent) {
    const ua = String(userAgent || '');
    const os = firstMatch(OPERATING_SYSTEMS, ua, 'Unknown OS');
    let deviceType = 'desktop';
    if (/iPad|Tablet/i.test(ua) || (os === 'Android' && !/Mobile/.test(ua))) deviceType = 'tablet';
    else if (/Mobi|iPhone|iPod/.test(ua)) deviceType = 'phone';
    return { browser: firstMatch(BROWSERS, ua, 'Unknown browser'), os, deviceType };
}


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


function describeDevice(userAgent, ip, signedInAt = new Date()) {
    return { ...parseUserAgent(userAgent), ip: maskIp(ip), signedInAt: new Date(signedInAt).toISOString() };
}

function deviceLabel(device) {
    if (!device) return 'Unknown device';
    return `${device.browser || 'Unknown browser'} on ${device.os || 'Unknown OS'}`;
}


function deviceFingerprint(device) {
    return [device && device.browser, device && device.os, device && device.deviceType].join('|');
}


function passwordStamp(user) {
    if (!user || !user.password) return null;
    return crypto.createHash('sha256').update(String(user.password)).digest('hex').slice(0, 16);
}

module.exports = { parseUserAgent, maskIp, describeDevice, deviceLabel, deviceFingerprint, passwordStamp };
