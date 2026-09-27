const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { MongoSessionStore, buildSessionOptions, SESSION_TTL_MS, TOUCH_AFTER_MS, DEV_SECRET } = require('../utils/sessionStore');

const HOUR = 60 * 60 * 1000;

// Just enough of a MongoDB collection for the store, keeping every call.
function fakeCollection() {
    const docs = new Map();
    const calls = [];
    return {
        docs,
        calls,
        async createIndex(spec, options) {
            calls.push(['createIndex', spec, options]);
            return 'expires_1';
        },
        async findOne(filter) {
            calls.push(['findOne', filter]);
            const doc = docs.get(filter._id);
            return doc ? { _id: filter._id, ...doc } : null;
        },
        async updateOne(filter, update, options = {}) {
            calls.push(['updateOne', filter, update, options]);
            const existing = docs.get(filter._id);
            if (!existing && !options.upsert) return { matchedCount: 0 };
            if (existing && filter.lastModified && !(existing.lastModified < filter.lastModified.$lt)) return { matchedCount: 0 };
            docs.set(filter._id, { ...(existing || {}), ...update.$set });
            return { matchedCount: 1 };
        },
        async deleteOne(filter) {
            calls.push(['deleteOne', filter]);
            docs.delete(filter._id);
            return { deletedCount: 1 };
        }
    };
}

const storeOn = (collection, clock) => new MongoSessionStore({
    connection: { collection: () => collection },
    now: () => clock.now
});
const call = (store, method, ...args) => new Promise((resolve, reject) => {
    store[method](...args, (err, value) => (err ? reject(err) : resolve(value)));
});
const sessionFor = (userId, expires) => ({ cookie: { httpOnly: true, expires, originalMaxAge: SESSION_TTL_MS }, passport: { user: userId } });

test('a saved session can be read back, with its expiry from the cookie', async () => {
    const clock = { now: Date.parse('2026-09-27T10:00:00Z') };
    const collection = fakeCollection();
    const store = storeOn(collection, clock);
    const expires = new Date(clock.now + SESSION_TTL_MS);

    await call(store, 'set', 'sid-1', sessionFor('u1', expires));
    const loaded = await call(store, 'get', 'sid-1');

    assert.equal(loaded.passport.user, 'u1');
    assert.equal(collection.docs.get('sid-1').expires.toISOString(), expires.toISOString());
    assert.deepEqual(collection.calls.find(c => c[0] === 'createIndex').slice(1), [{ expires: 1 }, { expireAfterSeconds: 0 }]);
});

test('a session survives a restart: a new store on the same database still finds it', async () => {
    const clock = { now: Date.parse('2026-09-27T10:00:00Z') };
    const collection = fakeCollection();
    await call(storeOn(collection, clock), 'set', 'sid-1', sessionFor('u1', new Date(clock.now + SESSION_TTL_MS)));

    const afterRestart = storeOn(collection, clock);
    assert.equal((await call(afterRestart, 'get', 'sid-1')).passport.user, 'u1');
});

test('the TTL index is only created once per store', async () => {
    const clock = { now: Date.parse('2026-09-27T10:00:00Z') };
    const collection = fakeCollection();
    const store = storeOn(collection, clock);
    await call(store, 'set', 'a', sessionFor('u1', new Date(clock.now + SESSION_TTL_MS)));
    await call(store, 'set', 'b', sessionFor('u2', new Date(clock.now + SESSION_TTL_MS)));
    const indexes = collection.calls.filter(c => c[0] === 'createIndex').map(c => Object.keys(c[1])[0]);
    assert.deepEqual(indexes.sort(), ['expires', 'userId'], 'the TTL index and the per-user index (#196), once each');
});

test('missing and expired sessions come back empty, and expired ones are removed', async () => {
    const clock = { now: Date.parse('2026-09-27T10:00:00Z') };
    const collection = fakeCollection();
    const store = storeOn(collection, clock);
    assert.equal(await call(store, 'get', 'nope'), null);

    await call(store, 'set', 'old', sessionFor('u1', new Date(clock.now + HOUR)));
    clock.now += 2 * HOUR;
    assert.equal(await call(store, 'get', 'old'), null);
    assert.equal(collection.docs.has('old'), false);
});

test('logging out deletes the session', async () => {
    const clock = { now: Date.parse('2026-09-27T10:00:00Z') };
    const collection = fakeCollection();
    const store = storeOn(collection, clock);
    await call(store, 'set', 'sid-1', sessionFor('u1', new Date(clock.now + SESSION_TTL_MS)));
    await call(store, 'destroy', 'sid-1');
    assert.equal(collection.docs.has('sid-1'), false);
    assert.equal(await call(store, 'get', 'sid-1'), null);
});

test('activity renews the expiry, but at most once an hour', async () => {
    const clock = { now: Date.parse('2026-09-27T10:00:00Z') };
    const collection = fakeCollection();
    const store = storeOn(collection, clock);
    await call(store, 'set', 'sid-1', sessionFor('u1', new Date(clock.now + SESSION_TTL_MS)));
    const writes = () => collection.calls.filter(c => c[0] === 'updateOne').length;

    clock.now += 10 * 60 * 1000;
    await call(store, 'touch', 'sid-1', sessionFor('u1', new Date(clock.now + SESSION_TTL_MS)));
    assert.equal(writes(), 1, 'no write within the first hour');

    clock.now += TOUCH_AFTER_MS;
    const renewed = new Date(clock.now + SESSION_TTL_MS);
    await call(store, 'touch', 'sid-1', sessionFor('u1', renewed));
    assert.equal(writes(), 2);
    assert.equal(collection.docs.get('sid-1').expires.toISOString(), renewed.toISOString());

    await call(store, 'touch', 'sid-1', sessionFor('u1', renewed));
    assert.equal(writes(), 2, 'a second touch straight after is skipped');
});

test('after a restart the first touch only writes if the stored copy is over an hour old', async () => {
    const clock = { now: Date.parse('2026-09-27T10:00:00Z') };
    const collection = fakeCollection();
    await call(storeOn(collection, clock), 'set', 'sid-1', sessionFor('u1', new Date(clock.now + SESSION_TTL_MS)));

    clock.now += 5 * 60 * 1000;
    const fresh = storeOn(collection, clock);
    const before = collection.docs.get('sid-1').expires.toISOString();
    await call(fresh, 'touch', 'sid-1', sessionFor('u1', new Date(clock.now + SESSION_TTL_MS)));
    const touch = collection.calls.filter(c => c[0] === 'updateOne').pop();
    assert.ok(touch[1].lastModified.$lt instanceof Date, 'the renewal is conditional');
    assert.equal(collection.docs.get('sid-1').expires.toISOString(), before, 'nothing changed for a recent session');
});

test('sessions last 7 days from the last visit, with safe cookies', () => {
    const options = buildSessionOptions({ env: { SESSION_SECRET: 's3cret' }, connection: { collection: () => fakeCollection() } });
    assert.equal(options.secret, 's3cret');
    assert.equal(options.rolling, true);
    assert.equal(options.resave, false);
    assert.equal(options.saveUninitialized, false);
    assert.ok(options.store instanceof MongoSessionStore);
    assert.deepEqual(options.cookie, { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 7 * 24 * HOUR });
});

test('production cookies are secure, and a missing secret is reported instead of crashing', () => {
    const errors = [];
    const logger = { error: message => errors.push(message) };
    const connection = { collection: () => fakeCollection() };

    const prod = buildSessionOptions({ env: { NODE_ENV: 'production', SESSION_SECRET: 'x' }, connection, logger });
    assert.equal(prod.cookie.secure, true);
    assert.equal(errors.length, 0);

    const missing = buildSessionOptions({ env: { NODE_ENV: 'production' }, connection, logger });
    assert.equal(missing.secret, DEV_SECRET);
    assert.match(errors[0], /SESSION_SECRET is not set/);

    buildSessionOptions({ env: {}, connection, logger });
    assert.equal(errors.length, 1, 'no warning in development');
});

test('the app uses the MongoDB session options and trusts the proxy in production', () => {
    const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    assert.match(app, /session\(require\('\.\/utils\/sessionStore'\)\.buildSessionOptions\(\)\)/);
    assert.match(app, /NODE_ENV === 'production'\) app\.set\('trust proxy', 1\)/);
    assert.doesNotMatch(app, /secret: process\.env\.SESSION_SECRET \|\| "supersecretkey"/);
});
