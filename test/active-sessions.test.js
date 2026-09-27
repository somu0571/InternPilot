const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');

const { parseUserAgent, maskIp, describeDevice, deviceLabel, deviceFingerprint, passwordStamp } = require('../utils/deviceInfo');
const { MongoSessionStore, SESSION_TTL_MS, handleFor } = require('../utils/sessionStore');
const { recordSignIn, NEW_SIGN_IN_TYPE, FRESH_SIGN_IN_MS } = require('../utils/signInDevices');
const { createTrackSession } = require('../middleware/trackSession');
const accountRouter = require('../routes/accountSessions');
const Notification = require('../models/Notification');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const UA = {
    androidChrome: 'Mozilla/5.0 (Linux; Android 14; ELI-NX9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    windowsFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
    macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    samsung: 'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
    androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
};

// --- reading devices ---

test('user agents are turned into a short device label, without versions', () => {
    assert.deepEqual(parseUserAgent(UA.androidChrome), { browser: 'Chrome', os: 'Android', deviceType: 'phone' });
    assert.deepEqual(parseUserAgent(UA.iphoneSafari), { browser: 'Safari', os: 'iOS', deviceType: 'phone' });
    assert.deepEqual(parseUserAgent(UA.windowsEdge), { browser: 'Edge', os: 'Windows', deviceType: 'desktop' });
    assert.deepEqual(parseUserAgent(UA.windowsFirefox), { browser: 'Firefox', os: 'Windows', deviceType: 'desktop' });
    assert.deepEqual(parseUserAgent(UA.macChrome), { browser: 'Chrome', os: 'macOS', deviceType: 'desktop' });
    assert.deepEqual(parseUserAgent(UA.samsung), { browser: 'Samsung Internet', os: 'Android', deviceType: 'phone' });
    assert.equal(parseUserAgent(UA.androidTablet).deviceType, 'tablet');
    assert.deepEqual(parseUserAgent(''), { browser: 'Unknown browser', os: 'Unknown OS', deviceType: 'desktop' });
    assert.equal(deviceLabel(parseUserAgent(UA.androidChrome)), 'Chrome on Android');
});

test('only the network part of an IP address is kept', () => {
    assert.equal(maskIp('103.87.59.36'), '103.87.59.x');
    assert.equal(maskIp('::ffff:192.168.1.20'), '192.168.1.x');
    assert.equal(maskIp('2401:4900:1c3a:9f2e::1'), '2401:4900:1c3a::');
    assert.equal(maskIp(''), 'unknown');
    const device = describeDevice(UA.androidChrome, '103.87.59.36', Date.parse('2026-09-27T13:00:00Z'));
    assert.equal(device.ip, '103.87.59.x');
    assert.equal(device.signedInAt, '2026-09-27T13:00:00.000Z');
    assert.doesNotMatch(JSON.stringify(device), /Mozilla|AppleWebKit|103\.87\.59\.36/, 'no raw user agent or full IP is stored');
});

test('the same browser on the same kind of device is one device, and passwords are fingerprinted', () => {
    const a = parseUserAgent(UA.androidChrome);
    const b = parseUserAgent(UA.androidChrome.replace('130.0.0.0', '131.0.0.0'));
    assert.equal(deviceFingerprint(a), deviceFingerprint(b), 'a browser update is not a new device');
    assert.notEqual(deviceFingerprint(a), deviceFingerprint(parseUserAgent(UA.windowsEdge)));

    assert.equal(passwordStamp({ password: undefined }), null, 'Google-only accounts have no stamp');
    assert.equal(passwordStamp({ password: '$2a$10$abc' }), passwordStamp({ password: '$2a$10$abc' }));
    assert.notEqual(passwordStamp({ password: '$2a$10$abc' }), passwordStamp({ password: '$2a$10$xyz' }));
    assert.doesNotMatch(passwordStamp({ password: '$2a$10$abc' }), /abc/);
});

// --- session store (a MongoDB collection double) ---

function fakeCollection() {
    const docs = new Map();
    const matches = (doc, filter) => Object.entries(filter).every(([key, cond]) => {
        const value = doc[key];
        if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
            if ('$exists' in cond && (value !== undefined) !== cond.$exists) return false;
            if ('$ne' in cond && value === cond.$ne) return false;
            if ('$gt' in cond && !(value > cond.$gt)) return false;
            if ('$lt' in cond && !(value < cond.$lt)) return false;
            return true;
        }
        return value === cond;
    });
    const apply = (doc, update, inserting) => {
        Object.assign(doc, update.$set || {});
        if (inserting) Object.assign(doc, update.$setOnInsert || {});
    };
    return {
        docs,
        async createIndex(spec) { return Object.keys(spec)[0]; },
        async findOne(filter) {
            for (const doc of docs.values()) if (matches(doc, filter)) return { ...doc };
            return null;
        },
        async updateOne(filter, update, options = {}) {
            for (const doc of docs.values()) {
                if (matches(doc, filter)) { apply(doc, update, false); return { matchedCount: 1, modifiedCount: 1 }; }
            }
            if (options.upsert) {
                const doc = { _id: filter._id };
                apply(doc, update, true);
                docs.set(doc._id, doc);
                return { matchedCount: 0, upsertedCount: 1 };
            }
            return { matchedCount: 0, modifiedCount: 0 };
        },
        async updateMany(filter, update) {
            let n = 0;
            for (const doc of docs.values()) if (matches(doc, filter)) { apply(doc, update, false); n += 1; }
            return { matchedCount: n, modifiedCount: n };
        },
        async deleteOne(filter) {
            for (const [id, doc] of docs) if (matches(doc, filter)) { docs.delete(id); return { deletedCount: 1 }; }
            return { deletedCount: 0 };
        },
        find(filter) {
            const rows = [...docs.values()].filter(doc => matches(doc, filter)).map(doc => ({ ...doc }));
            return { project() { return this; }, async toArray() { return rows; } };
        }
    };
}

const storeOn = collection => new MongoSessionStore({ connection: { collection: () => collection } });
const call = (store, method, ...args) => new Promise((resolve, reject) => store[method](...args, (err, value) => (err ? reject(err) : resolve(value))));
const signedIn = (user, device) => ({
    cookie: { expires: new Date(Date.now() + SESSION_TTL_MS), originalMaxAge: SESSION_TTL_MS },
    passport: { user },
    ...(device ? { device, pwdStamp: 'stamp1' } : {})
});

test('the store keeps who and which device each session belongs to', async () => {
    const collection = fakeCollection();
    const store = storeOn(collection);
    const device = describeDevice(UA.androidChrome, '103.87.59.36');
    await call(store, 'set', 'sid-a', signedIn('u1', device));
    const doc = collection.docs.get('sid-a');
    assert.equal(doc.userId, 'u1');
    assert.deepEqual(doc.device, device);
    assert.equal(doc.pwdStamp, 'stamp1');
    assert.ok(doc.createdAt instanceof Date);

    const firstCreated = doc.createdAt;
    await call(store, 'set', 'sid-a', signedIn('u1', device));
    assert.equal(collection.docs.get('sid-a').createdAt, firstCreated, 'createdAt is only set when the session is first saved');
    assert.ok(await store.createdAt('sid-a'));

    collection.docs.set('old', { _id: 'old', session: '{}', expires: new Date(Date.now() + 1000) });
    assert.equal(await store.createdAt('old'), null, 'sessions saved before this feature have no createdAt');
});

test('listing shows only this account\'s live sessions', async () => {
    const collection = fakeCollection();
    const store = storeOn(collection);
    await call(store, 'set', 'mine-1', signedIn('u1'));
    await call(store, 'set', 'mine-2', signedIn('u1'));
    await call(store, 'set', 'theirs', signedIn('u2'));
    collection.docs.set('expired', { _id: 'expired', userId: 'u1', expires: new Date(Date.now() - 1000) });
    collection.docs.set('revoked', { _id: 'revoked', userId: 'u1', expires: new Date(Date.now() + 60000), revokedAt: new Date() });

    const list = await store.listForUser('u1');
    assert.deepEqual(list.map(s => s.sid).sort(), ['mine-1', 'mine-2']);
    assert.equal(list[0].handle, handleFor(list[0].sid));
    assert.notEqual(list[0].handle, list[0].sid, 'the page never sees real session ids');
});

test('a signed-out session stays signed out, even if its device saves it late', async () => {
    const collection = fakeCollection();
    const store = storeOn(collection);
    await call(store, 'set', 'phone', signedIn('u1'));
    assert.equal(await store.revoke('u2', 'phone'), false, 'nobody can sign out someone else\'s session');
    assert.equal(await store.revoke('u1', 'phone'), true);
    assert.equal(await call(store, 'get', 'phone'), null);

    // A request that was already running on the phone finishes and saves.
    await call(store, 'set', 'phone', signedIn('u1'));
    assert.equal(await call(store, 'get', 'phone'), null, 'still signed out');
    assert.equal((await store.listForUser('u1')).length, 0);
});

test('signing out the other devices keeps this one', async () => {
    const collection = fakeCollection();
    const store = storeOn(collection);
    for (const sid of ['this', 'other-1', 'other-2']) await call(store, 'set', sid, signedIn('u1'));
    await call(store, 'set', 'someone-else', signedIn('u2'));
    assert.equal(await store.revokeOthers('u1', 'this'), 2);
    assert.deepEqual((await store.listForUser('u1')).map(s => s.sid), ['this']);
    assert.ok(await call(store, 'get', 'someone-else'), 'other accounts are untouched');
});

// --- new-device alerts ---

function deviceModels() {
    const devices = [];
    const notifications = [];
    return {
        devices,
        notifications,
        KnownDevice: {
            async findOneAndUpdate(filter, update) {
                const found = devices.find(d => String(d.user) === String(filter.user) && d.fingerprint === filter.fingerprint);
                if (found) { const before = { ...found }; Object.assign(found, update.$set); return before; }
                devices.push({ user: filter.user, fingerprint: filter.fingerprint, ...update.$set, ...update.$setOnInsert });
                return null;
            },
            async countDocuments(filter) {
                return devices.filter(d => String(d.user) === String(filter.user) && d.fingerprint !== filter.fingerprint.$ne).length;
            }
        },
        Notification: { async create(doc) { notifications.push(doc); return doc; } }
    };
}

const freshStore = (ageMs = 5000) => ({ createdAt: async () => new Date(Date.now() - ageMs) });
const candidate = { _id: 'u1', role: 'candidate' };

test('the first device is quiet; a sign-in from a new one alerts a candidate', async () => {
    const models = deviceModels();
    const phone = describeDevice(UA.androidChrome, '103.87.59.36');
    const laptop = describeDevice(UA.windowsEdge, '49.36.12.8');

    assert.deepEqual(await recordSignIn({ user: candidate, device: phone, sid: 's1', store: freshStore(), models }), { isNew: true, notified: false });
    assert.deepEqual(await recordSignIn({ user: candidate, device: phone, sid: 's2', store: freshStore(), models }), { isNew: false, notified: false });

    const result = await recordSignIn({ user: candidate, device: laptop, sid: 's3', store: freshStore(), models });
    assert.deepEqual(result, { isNew: true, notified: true });
    const [note] = models.notifications;
    assert.equal(note.recipient, 'u1');
    assert.equal(note.type, NEW_SIGN_IN_TYPE);
    assert.equal(note.link, '/account/sessions');
    assert.match(note.message, /Edge on Windows/);
    assert.match(note.message, /49\.36\.12\.x/);
    assert.ok(Notification.schema.path('type').enumValues.includes(NEW_SIGN_IN_TYPE), 'the type is registered on the model');
});

test('no alert for company accounts, or for sessions that were open before this shipped', async () => {
    const phone = describeDevice(UA.androidChrome, '1.2.3.4');
    const laptop = describeDevice(UA.macChrome, '1.2.3.4');

    const company = deviceModels();
    const recruiter = { _id: 'r1', role: 'recruiter' };
    await recordSignIn({ user: recruiter, device: phone, sid: 'a', store: freshStore(), models: company });
    assert.equal((await recordSignIn({ user: recruiter, device: laptop, sid: 'b', store: freshStore(), models: company })).notified, false,
        'company notifications are a shared team feed');

    const old = deviceModels();
    await recordSignIn({ user: candidate, device: phone, sid: 'a', store: freshStore(), models: old });
    const noCreatedAt = { createdAt: async () => null };
    assert.equal((await recordSignIn({ user: candidate, device: laptop, sid: 'b', store: noCreatedAt, models: old })).notified, false);

    const stale = deviceModels();
    await recordSignIn({ user: candidate, device: phone, sid: 'a', store: freshStore(), models: stale });
    const olderSession = freshStore(FRESH_SIGN_IN_MS + 60000);
    assert.equal((await recordSignIn({ user: candidate, device: laptop, sid: 'b', store: olderSession, models: stale })).notified, false);
});

test('two first requests at once do not break the sign-in', async () => {
    const models = deviceModels();
    models.KnownDevice.findOneAndUpdate = async () => { const err = new Error('E11000 duplicate key'); err.code = 11000; throw err; };
    assert.deepEqual(await recordSignIn({ user: candidate, device: describeDevice(UA.androidChrome, '1.2.3.4'), sid: 's', store: freshStore(), models }),
        { isNew: false, notified: false });
});

// --- the middleware ---

function reqFor(user, sessionData = {}) {
    return {
        user,
        session: { ...sessionData },
        sessionID: 'sid-1',
        sessionStore: { name: 'store' },
        ip: '103.87.59.36',
        flashed: [],
        get: h => (String(h).toLowerCase() === 'user-agent' ? UA.androidChrome : undefined),
        flash(type, msg) { this.flashed.push([type, msg]); },
        logout(cb) { this.loggedOut = true; cb(); }
    };
}
const resDouble = () => ({ redirect(url) { this.redirected = url; } });

test('the first signed-in request notes the device and the password fingerprint', async () => {
    const recorded = [];
    const track = createTrackSession({ recordSignIn: async args => { recorded.push(args); }, now: () => Date.parse('2026-09-27T13:00:00Z') });
    const user = { _id: 'u1', role: 'candidate', password: '$2a$10$abc' };
    const req = reqFor(user);
    let nextCalled = false;
    track(req, resDouble(), () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(req.session.device.browser, 'Chrome');
    assert.equal(req.session.device.ip, '103.87.59.x');
    assert.equal(req.session.pwdStamp, passwordStamp(user));
    await new Promise(r => setImmediate(r));
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].sid, 'sid-1');
    assert.equal(recorded[0].store.name, 'store');

    // Later requests don't record again.
    track(req, resDouble(), () => {});
    await new Promise(r => setImmediate(r));
    assert.equal(recorded.length, 1);
});

test('after a password change, other sessions are signed out on their next request', () => {
    const track = createTrackSession({ recordSignIn: async () => {} });
    const user = { _id: 'u1', role: 'candidate', password: '$2a$10$new' };
    const req = reqFor(user, { device: { browser: 'Chrome' }, pwdStamp: passwordStamp({ password: '$2a$10$old' }) });
    const res = resDouble();
    let nextCalled = false;
    track(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(req.loggedOut, true);
    assert.equal(res.redirected, '/auth/login');
    assert.match(req.flashed[0][1], /password was changed/);
});

test('Google-only accounts are never signed out by the password check, and old sessions get a fingerprint', () => {
    const track = createTrackSession({ recordSignIn: async () => {} });
    const google = reqFor({ _id: 'g1', role: 'candidate' }, { device: { browser: 'Chrome' } });
    let nextCalled = false;
    track(google, resDouble(), () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(google.session.pwdStamp, undefined);

    const user = { _id: 'u1', role: 'candidate', password: '$2a$10$abc' };
    const older = reqFor(user, { device: { browser: 'Chrome' } });
    track(older, resDouble(), () => {});
    assert.equal(older.session.pwdStamp, passwordStamp(user));
});

test('requests without a signed-in user are left alone', () => {
    const track = createTrackSession({ recordSignIn: async () => { throw new Error('should not run'); } });
    const req = reqFor(undefined);
    let nextCalled = false;
    track(req, resDouble(), () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(req.session.device, undefined);
});

// --- the page, end to end over HTTP ---

test('end to end: list devices, sign one out, sign out the rest, and a password change signs sessions out', async () => {
    const collection = fakeCollection();
    const store = storeOn(collection);
    const users = {
        u1: { _id: 'u1', name: 'Asha', role: 'candidate', isActive: true, password: 'hash-1' },
        u2: { _id: 'u2', name: 'Ravi', role: 'candidate', isActive: true, password: 'hash-2' }
    };

    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(root, 'views'));
    app.use(express.urlencoded({ extended: false }));
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false, rolling: true, store, cookie: { httpOnly: true, sameSite: 'lax', maxAge: SESSION_TTL_MS } }));
    app.use(flash());
    app.use((req, res, next) => { // stands in for passport
        const id = req.session && req.session.passport && req.session.passport.user;
        req.user = id ? users[id] : undefined;
        req.isAuthenticated = () => Boolean(req.user);
        req.logout = cb => { delete req.session.passport; req.session.regenerate(cb); };
        res.locals.layout = () => {};
        next();
    });
    app.get('/test/login/:id', (req, res) => req.session.regenerate(() => { req.session.passport = { user: req.params.id }; res.send('ok'); }));
    app.use(createTrackSession({ recordSignIn: async () => {} }));
    app.use(accountRouter);
    app.get('/auth/login', (req, res) => res.send('login page'));

    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const device = ua => ({ ua, cookie: '' });
    const go = async (d, url, method = 'GET') => {
        const res = await fetch(base + url, { method, redirect: 'manual', headers: { cookie: d.cookie, 'user-agent': d.ua } });
        const setCookie = res.headers.get('set-cookie');
        if (setCookie) d.cookie = setCookie.split(';')[0];
        return res;
    };
    const page = async d => (await go(d, '/account/sessions')).text();
    const handleOf = (html, label) => {
        const item = html.split('<li ').find(chunk => chunk.includes(label) && !chunk.includes('data-current-device'));
        return item && item.match(/data-session="([a-f0-9]+)"/)[1];
    };

    try {
        const phone = device(UA.androidChrome);
        const laptop = device(UA.windowsFirefox);
        const stranger = device(UA.macChrome);
        await go(phone, '/test/login/u1');
        await go(laptop, '/test/login/u1');
        await go(stranger, '/test/login/u2');
        await page(laptop); // the laptop's device is noted on its first page
        await page(stranger);

        let html = await page(phone);
        assert.equal((html.match(/data-session="/g) || []).length, 2, 'both of Asha\'s devices, not Ravi\'s');
        assert.equal((html.match(/data-current-device/g) || []).length, 1);
        assert.match(html, /Chrome on Android/);
        assert.match(html, /Firefox on Windows/);
        assert.match(html, /data-sign-out-others/);

        // Sign the laptop out from the phone.
        const laptopHandle = handleOf(html, 'Firefox on Windows');
        assert.ok(laptopHandle);
        const signOut = await go(phone, `/account/sessions/${laptopHandle}/sign-out`, 'POST');
        assert.equal(signOut.status, 302);
        const laptopNext = await go(laptop, '/account/sessions');
        assert.equal(laptopNext.status, 302, 'the laptop is signed out');
        assert.equal(laptopNext.headers.get('location'), '/auth/login');
        assert.equal((await go(phone, '/account/sessions')).status, 200, 'the phone is still signed in');

        // Ravi's session can't be signed out from Asha's account.
        const raviHandle = handleOf(await page(stranger), 'Chrome on macOS') || handleFor([...collection.docs.values()].find(d => d.userId === 'u2')._id);
        await go(phone, `/account/sessions/${raviHandle}/sign-out`, 'POST');
        assert.equal((await go(stranger, '/account/sessions')).status, 200, 'Ravi is still signed in');

        // Sign out every other device.
        const tablet = device(UA.androidTablet);
        await go(tablet, '/test/login/u1');
        await page(tablet);
        assert.equal((await go(phone, '/account/sessions/sign-out-others', 'POST')).status, 302);
        assert.equal((await go(tablet, '/account/sessions')).status, 302, 'the tablet is signed out');
        html = await page(phone);
        assert.match(html, /data-only-this-device/);

        // A password reset elsewhere signs this session out on its next request.
        users.u1.password = 'hash-after-reset';
        const afterReset = await go(phone, '/account/sessions');
        assert.equal(afterReset.status, 302);
        assert.equal(afterReset.headers.get('location'), '/auth/login');
    } finally {
        server.close();
    }
});

// --- wiring ---

test('the app records sessions and serves the page before the other routes', () => {
    const app = read('app.js');
    const track = app.indexOf("require('./middleware/trackSession')");
    const page = app.indexOf("require('./routes/accountSessions')");
    assert.ok(track > app.indexOf('app.use(passport.session())'), 'after passport has loaded the user');
    assert.ok(track > 0 && page > track);
    assert.ok(page < app.indexOf("require('./routes/messages')"), 'before the page routes');
});

test('the header links to the page, and candidates see the new-sign-in notification styled', () => {
    const header = read('views/partials/header.ejs');
    assert.equal((header.match(/href="\/account\/sessions"/g) || []).length, 2, 'desktop menu and mobile menu');
    const notifications = read('views/candidate/notifications.ejs');
    assert.match(notifications, /security_new_sign_in/);
});

test('the page renders with sessions, and with only this device', () => {
    const file = path.join(root, 'views/account/sessions.ejs');
    const template = read('views/account/sessions.ejs');
    const render = locals => ejs.render(template, { layout: () => {}, ...locals }, { filename: file });
    const many = render({
        otherCount: 1,
        sessions: [
            { handle: 'aaa', current: true, label: 'Chrome on Android', deviceType: 'phone', ip: '103.87.59.x', signedInLabel: '27 Sept 2026', activeLabel: 'Active now' },
            { handle: 'bbb', current: false, label: 'Edge on Windows', deviceType: 'desktop', ip: '49.36.12.x', signedInLabel: '25 Sept 2026', activeLabel: 'Last active 2 days ago' }
        ]
    });
    assert.match(many, /action="\/account\/sessions\/bbb\/sign-out"/);
    assert.doesNotMatch(many, /action="\/account\/sessions\/aaa\/sign-out"/, 'no sign-out button for this device');
    assert.match(many, /action="\/account\/sessions\/sign-out-others"/);
    assert.match(many, /ph-device-mobile/);
    assert.match(many, /ph-desktop/);

    const single = render({ otherCount: 0, sessions: [{ handle: 'aaa', current: true, label: 'Chrome on Android', deviceType: 'phone', ip: '103.87.59.x', signedInLabel: 'now', activeLabel: 'Active now' }] });
    assert.match(single, /Only this device is signed in/);
    assert.doesNotMatch(single, /sign-out-others/);
});

test('last-active labels', () => {
    const { lastActiveLabel } = accountRouter;
    const now = Date.parse('2026-09-27T13:00:00Z');
    assert.equal(lastActiveLabel(new Date(now - 10 * 60 * 1000), now), 'Active in the last hour');
    assert.equal(lastActiveLabel(new Date(now - 3 * 60 * 60 * 1000), now), 'Last active 3 hours ago');
    assert.equal(lastActiveLabel(new Date(now - 26 * 60 * 60 * 1000), now), 'Last active 1 day ago');
    assert.equal(lastActiveLabel(null, now), 'Last active: unknown');
});
