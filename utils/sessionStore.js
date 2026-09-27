const crypto = require('crypto');
const session = require('express-session');
const mongoose = require('mongoose');

const DAY_MS = 24 * 60 * 60 * 1000;
// A session lasts 7 days from the last visit.
const SESSION_TTL_MS = 7 * DAY_MS;
// Unchanged sessions have their expiry renewed at most once an hour, so
// page views don't each cost a database write.
const TOUCH_AFTER_MS = 60 * 60 * 1000;
// The previous built-in default, still used for local development.
const DEV_SECRET = 'supersecretkey';
const TOUCH_MEMORY_LIMIT = 10000;

// Top-level copies of whose session this is and which device it's on, so the
// signed-in devices page (#196) can list an account's sessions with one query.
function ownerFields(sess) {
    const fields = {};
    const userId = sess && sess.passport && sess.passport.user;
    if (userId) fields.userId = String(userId);
    if (sess && sess.device) fields.device = sess.device;
    if (sess && sess.pwdStamp) fields.pwdStamp = sess.pwdStamp;
    return fields;
}

/** An id for a session that is safe to put in a page: a hash, never the session id itself. */
function handleFor(sid) {
    return crypto.createHash('sha256').update(String(sid)).digest('hex').slice(0, 24);
}

/**
 * An express-session store that keeps sessions in MongoDB through the app's
 * existing Mongoose connection, so restarts and deploys don't sign everyone
 * out. A TTL index on `expires` lets MongoDB delete expired sessions.
 */
class MongoSessionStore extends session.Store {
    constructor({
        connection = mongoose.connection,
        collectionName = 'sessions',
        ttlMs = SESSION_TTL_MS,
        touchAfterMs = TOUCH_AFTER_MS,
        now = () => Date.now()
    } = {}) {
        super();
        this.connection = connection;
        this.collectionName = collectionName;
        this.ttlMs = ttlMs;
        this.touchAfterMs = touchAfterMs;
        this.now = now;
        this.lastTouched = new Map();
        this.indexReady = null;
    }

    collection() {
        return this.connection.collection(this.collectionName);
    }

    ensureIndex() {
        if (!this.indexReady) {
            this.indexReady = Promise.all([
                this.collection().createIndex({ expires: 1 }, { expireAfterSeconds: 0 }),
                // Lets the signed-in devices page (#196) find a user's sessions quickly.
                this.collection().createIndex({ userId: 1 })
            ])
                .catch(err => {
                    this.indexReady = null;
                    throw err;
                });
        }
        return this.indexReady;
    }

    expiryFor(sess) {
        const fromCookie = sess && sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires) : null;
        return fromCookie && !Number.isNaN(fromCookie.getTime()) ? fromCookie : new Date(this.now() + this.ttlMs);
    }

    remember(sid, time) {
        if (this.lastTouched.size >= TOUCH_MEMORY_LIMIT) this.lastTouched.clear();
        this.lastTouched.set(sid, time);
    }

    get(sid, callback) {
        Promise.resolve(this.collection().findOne({ _id: sid }))
            .then(doc => {
                if (!doc) return callback(null, null);
                // A session signed out from another device (#196). The marked
                // document is kept until it expires, so a late save from that
                // device can't bring the session back.
                if (doc.revokedAt) return callback(null, null);
                // MongoDB's TTL monitor runs about once a minute, so don't hand
                // back a session that has already expired.
                if (doc.expires && new Date(doc.expires).getTime() <= this.now()) {
                    return this.destroy(sid, () => callback(null, null));
                }
                return callback(null, typeof doc.session === 'string' ? JSON.parse(doc.session) : doc.session);
            })
            .catch(err => callback(err));
    }

    set(sid, sess, callback = () => {}) {
        const now = this.now();
        this.ensureIndex()
            .then(() => this.collection().updateOne(
                { _id: sid },
                {
                    $set: { session: JSON.stringify(sess), expires: this.expiryFor(sess), lastModified: new Date(now), ...ownerFields(sess) },
                    $setOnInsert: { createdAt: new Date(now) }
                },
                { upsert: true }
            ))
            .then(() => {
                this.remember(sid, now);
                callback(null);
            })
            .catch(err => callback(err));
    }

    /** Renews the expiry of a session that wasn't changed by the request, at most once per touchAfterMs. */
    touch(sid, sess, callback = () => {}) {
        const now = this.now();
        const last = this.lastTouched.get(sid);
        if (last && now - last < this.touchAfterMs) return callback(null);
        Promise.resolve(this.collection().updateOne(
            { _id: sid, lastModified: { $lt: new Date(now - this.touchAfterMs) } },
            // ownerFields also fills in sessions saved before #196 added them.
            { $set: { expires: this.expiryFor(sess), lastModified: new Date(now), ...ownerFields(sess) } }
        ))
            .then(() => {
                this.remember(sid, now);
                callback(null);
            })
            .catch(err => callback(err));
    }

    destroy(sid, callback = () => {}) {
        this.lastTouched.delete(sid);
        Promise.resolve(this.collection().deleteOne({ _id: sid }))
            .then(() => callback(null))
            .catch(err => callback(err));
    }

    // --- Signed-in devices (#196) ---

    /** This account's live sessions: not expired and not signed out. */
    async listForUser(userId) {
        const docs = await this.collection()
            .find({ userId: String(userId), expires: { $gt: new Date(this.now()) }, revokedAt: { $exists: false } })
            .project({ device: 1, pwdStamp: 1, createdAt: 1, lastModified: 1, expires: 1 })
            .toArray();
        return docs.map(doc => ({
            sid: doc._id,
            handle: handleFor(doc._id),
            device: doc.device || null,
            pwdStamp: doc.pwdStamp || null,
            createdAt: doc.createdAt || null,
            lastActiveAt: doc.lastModified || null
        }));
    }

    /** When the session document was first saved, or null for sessions saved before #196. */
    async createdAt(sid) {
        const doc = await this.collection().findOne({ _id: sid }, { projection: { createdAt: 1 } });
        return doc && doc.createdAt ? new Date(doc.createdAt) : null;
    }

    /**
     * Signs one of this user's sessions out. The document is marked rather than
     * deleted, so a request already in flight on that device can't save the
     * session back to life; get() treats a marked session as gone.
     */
    async revoke(userId, sid) {
        this.lastTouched.delete(sid);
        const result = await this.collection().updateOne(
            { _id: sid, userId: String(userId), revokedAt: { $exists: false } },
            { $set: { revokedAt: new Date(this.now()) } }
        );
        return Boolean(result && result.matchedCount);
    }

    /** Signs out every other session of this user; returns how many. */
    async revokeOthers(userId, keepSid) {
        const result = await this.collection().updateMany(
            { userId: String(userId), _id: { $ne: keepSid }, revokedAt: { $exists: false } },
            { $set: { revokedAt: new Date(this.now()) } }
        );
        return (result && result.modifiedCount) || 0;
    }
}

/**
 * Options for express-session: sessions in MongoDB, 7 days from the last
 * visit, and hardened cookies in production. A missing SESSION_SECRET in
 * production is logged loudly instead of stopping the app, so a missing
 * variable can't take the site down on deploy.
 */
function buildSessionOptions({ env = process.env, connection = mongoose.connection, logger = console } = {}) {
    const production = env.NODE_ENV === 'production';
    let secret = env.SESSION_SECRET;
    if (!secret) {
        if (production) {
            logger.error('SESSION_SECRET is not set. Set it in the hosting environment: without it, session cookies use a public default and can be forged.');
        }
        secret = DEV_SECRET;
    }
    return {
        secret,
        resave: false,
        saveUninitialized: false,
        // Every visit pushes the expiry 7 days out again.
        rolling: true,
        store: new MongoSessionStore({ connection }),
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            secure: production,
            maxAge: SESSION_TTL_MS
        }
    };
}

module.exports = {
    SESSION_TTL_MS,
    TOUCH_AFTER_MS,
    DEV_SECRET,
    MongoSessionStore,
    buildSessionOptions,
    handleFor
};
