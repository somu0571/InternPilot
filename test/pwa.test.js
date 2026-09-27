const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const sw = require('../public/sw.js');

const ORIGIN = 'https://internpilot.example';

// Width and height straight from a PNG's IHDR chunk.
function pngSize(file) {
    const buf = fs.readFileSync(file);
    assert.equal(buf.toString('hex', 0, 8), '89504e470d0a1a0a', `${path.basename(file)} is a PNG`);
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// --- manifest and icons ---

test('the web app manifest has what browsers need to install the app', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, 'manifest.webmanifest'), 'utf8'));
    assert.equal(manifest.short_name, 'InternPilot');
    assert.match(manifest.name, /InternPilot/);
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.scope, '/');
    assert.equal(manifest.display, 'standalone');
    assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
    assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);

    const any = manifest.icons.filter(i => (i.purpose || 'any') === 'any').map(i => i.sizes);
    const maskable = manifest.icons.filter(i => i.purpose === 'maskable').map(i => i.sizes);
    assert.ok(any.includes('192x192') && any.includes('512x512'), 'regular 192 and 512 icons');
    assert.ok(maskable.includes('512x512'), 'a maskable 512 icon for Android');
});

test('every icon the manifest lists exists at the size it claims', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, 'manifest.webmanifest'), 'utf8'));
    const icons = [...manifest.icons, ...manifest.shortcuts.flatMap(s => s.icons || [])];
    for (const icon of icons) {
        const file = path.join(publicDir, icon.src);
        assert.ok(fs.existsSync(file), `${icon.src} exists`);
        const [w, h] = icon.sizes.split('x').map(Number);
        assert.deepEqual(pngSize(file), { width: w, height: h }, `${icon.src} is ${icon.sizes}`);
    }
    assert.deepEqual(pngSize(path.join(publicDir, 'icons/apple-touch-icon.png')), { width: 180, height: 180 });
});

test('the offline page works with no network: nothing loaded from other sites', () => {
    const html = fs.readFileSync(path.join(publicDir, 'offline.html'), 'utf8');
    assert.match(html, /<html lang="en">/);
    assert.match(html, /name="robots" content="noindex"/);
    assert.match(html, /Try again/);
    assert.doesNotMatch(html, /(src|href)="https?:\/\//, 'no external scripts, styles or images');
    assert.doesNotMatch(html, /<link[^>]+stylesheet/, 'styles are inline');
    // The only asset it uses is precached by the service worker.
    for (const [, url] of html.matchAll(/src="([^"]+)"/g)) {
        assert.ok(sw.PRECACHE_URLS.includes(url), `${url} is precached`);
    }
});

// --- service worker: what gets cached ---

const req = (url, { method = 'GET', mode = 'no-cors' } = {}) => ({ url: new URL(url, ORIGIN).href, method, mode });

test('pages go to the network, static files are cached, personal data never is', () => {
    const s = (url, opts) => sw.strategyFor(req(url, opts), ORIGIN);

    // Pages: network with the offline fallback, never cached.
    assert.equal(s('/', { mode: 'navigate' }), 'page');
    assert.equal(s('/candidate/profile', { mode: 'navigate' }), 'page');
    assert.equal(s('/auth/login', { mode: 'navigate' }), 'page');

    // Our static files and the CDN files the layout loads.
    assert.equal(s('/css/header.css'), 'static');
    assert.equal(s('/js/pwa.js'), 'static');
    assert.equal(s('/images/internpilot-logo.svg'), 'static');
    assert.equal(s('/icons/icon-192.png'), 'static');
    assert.equal(s('/manifest.webmanifest'), 'static');
    assert.equal(s('https://cdn.tailwindcss.com/'), 'static');
    assert.equal(s('https://unpkg.com/@phosphor-icons/web'), 'static');
    assert.equal(s('https://fonts.gstatic.com/s/inter/v1/x.woff2'), 'static');

    // Left alone: form posts, data requests, uploads, other sites, the worker itself.
    assert.equal(s('/auth/login', { method: 'POST', mode: 'navigate' }), 'bypass');
    assert.equal(s('/messages/123/updates'), 'bypass');
    assert.equal(s('/api/v1/analytics/landing-stats'), 'bypass');
    assert.equal(s('/uploads/resumes/someone.pdf'), 'bypass', 'resumes are never stored on the device');
    assert.equal(s('https://res.cloudinary.com/demo/raw/upload/resume.pdf'), 'bypass');
    assert.equal(s('http://cdn.tailwindcss.com/'), 'bypass', 'only https CDN files');
    assert.equal(s('/sw.js'), 'bypass');
});

// Minimal Cache Storage double.
function fakeCaches() {
    const stores = new Map();
    const keyOf = r => (typeof r === 'string' ? new URL(r, ORIGIN).href : r.url);
    const open = async name => {
        if (!stores.has(name)) stores.set(name, new Map());
        const map = stores.get(name);
        return {
            map,
            async match(r) { return map.get(keyOf(r)); },
            async put(r, res) { map.set(keyOf(r), res); },
            async keys() { return [...map.keys()].map(url => ({ url })); },
            async delete(r) { return map.delete(keyOf(r)); },
            async addAll(urls) { for (const u of urls) map.set(keyOf(u), new Response(`cached ${u}`)); }
        };
    };
    return {
        stores,
        open,
        async keys() { return [...stores.keys()]; },
        async delete(name) { return stores.delete(name); },
        async match(r) {
            for (const map of stores.values()) if (map.has(keyOf(r))) return map.get(keyOf(r));
            return undefined;
        }
    };
}

test('offline, a page request shows the offline page', async () => {
    const caches = fakeCaches();
    await sw.precache({ caches });
    const res = await sw.handlePage(req('/internships', { mode: 'navigate' }), {
        caches,
        fetch: async () => { throw new TypeError('Failed to fetch'); }
    });
    assert.equal(await res.text(), 'cached /offline.html');
});

test('online, pages come from the network and are not stored', async () => {
    const caches = fakeCaches();
    await sw.precache({ caches });
    const before = (await caches.open(sw.STATIC_CACHE)).map.size;
    const res = await sw.handlePage(req('/candidate/profile', { mode: 'navigate' }), {
        caches,
        fetch: async () => new Response('your profile')
    });
    assert.equal(await res.text(), 'your profile');
    assert.equal((await caches.open(sw.STATIC_CACHE)).map.size, before, 'nothing new was cached');
});

test('static files: cached copy first, refreshed in the background', async () => {
    const caches = fakeCaches();
    const cache = await caches.open(sw.STATIC_CACHE);
    await cache.put(req('/css/header.css'), new Response('old css'));
    const background = [];
    const res = await sw.handleStatic(req('/css/header.css'), {
        caches,
        fetch: async () => new Response('new css'),
        waitUntil: p => background.push(p)
    });
    assert.equal(await res.text(), 'old css', 'served straight from the cache');
    await Promise.all(background);
    assert.equal(await (await cache.match(req('/css/header.css'))).text(), 'new css', 'and refreshed for next time');
});

test('static files: a miss is fetched and stored, but errors are not stored', async () => {
    const caches = fakeCaches();
    const ok = await sw.handleStatic(req('/js/pwa.js'), { caches, fetch: async () => new Response('js') });
    assert.equal(await ok.text(), 'js');
    const cache = await caches.open(sw.STATIC_CACHE);
    assert.ok(await cache.match(req('/js/pwa.js')));

    const missing = await sw.handleStatic(req('/js/nope.js'), { caches, fetch: async () => new Response('no', { status: 404 }) });
    assert.equal(missing.status, 404);
    assert.equal(await cache.match(req('/js/nope.js')), undefined, 'a 404 is not cached');
    assert.equal(sw.cacheable({ ok: false, type: 'opaque' }), true, 'opaque CDN responses can be cached');
});

test('activating a new version removes only our old caches', async () => {
    const caches = fakeCaches();
    await caches.open('internpilot-static-v0');
    await caches.open(sw.STATIC_CACHE);
    await caches.open('some-other-app');
    await sw.removeOldCaches({ caches });
    assert.deepEqual((await caches.keys()).sort(), [sw.STATIC_CACHE, 'some-other-app'].sort());
});

// --- layout wiring ---

test('every page using the layout gets the manifest, icons and the install script', async () => {
    const layout = fs.readFileSync(path.join(root, 'views/layouts/boilerplate.ejs'), 'utf8');
    assert.match(layout, /include\('\.\.\/partials\/pwa-head'\)/);
    assert.ok(layout.indexOf('partials/pwa-head') < layout.indexOf('</head>'), 'inside <head>');

    const html = await ejs.renderFile(path.join(root, 'views/partials/pwa-head.ejs'), {});
    assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
    assert.match(html, /<meta name="theme-color" content="#4f46e5">/);
    assert.match(html, /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png">/);
    assert.match(html, /<script src="\/js\/pwa\.js" defer><\/script>/);
});

// --- install prompt (public/js/pwa.js) in a tiny fake browser ---

class FakeElement {
    constructor(tag) {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.listeners = {};
        this.attributes = {};
        this.parentNode = null;
        this.className = '';
        this.textContent = '';
        this.id = '';
    }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    removeChild(child) { this.children = this.children.filter(c => c !== child); child.parentNode = null; return child; }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    click() { (this.listeners.click || []).forEach(fn => fn({})); }
    all() { return [this, ...this.children.flatMap(c => c.all())]; }
}

function fakeStorage(shared) {
    const map = shared || new Map();
    return { map, getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
}

function browser({ userAgent = 'Mozilla/5.0 (Linux; Android 14) Chrome/128', standalone = false, local, session } = {}) {
    const head = new FakeElement('head');
    const body = new FakeElement('body');
    const winListeners = {};
    const registered = [];
    const navigator = {
        userAgent,
        standalone: false,
        serviceWorker: { register: url => { registered.push(url); return Promise.resolve({}); } }
    };
    const window = {
        navigator,
        localStorage: fakeStorage(local),
        sessionStorage: fakeStorage(session),
        matchMedia: () => ({ matches: standalone }),
        addEventListener: (type, fn) => { (winListeners[type] = winListeners[type] || []).push(fn); }
    };
    const document = {
        head,
        body,
        createElement: tag => new FakeElement(tag),
        getElementById: id => [...head.all(), ...body.all()].find(el => el.id === id) || null
    };
    vm.runInNewContext(fs.readFileSync(path.join(publicDir, 'js/pwa.js'), 'utf8'), { window, document, navigator, console });
    return {
        window,
        registered,
        fire: (type, event = {}) => (winListeners[type] || []).forEach(fn => fn(event)),
        banner: () => body.children.find(el => el.className === 'ip-install') || null
    };
}

const installEvent = (outcome = 'dismissed') => {
    const event = { prevented: false, prompted: false };
    event.preventDefault = () => { event.prevented = true; };
    event.prompt = () => { event.prompted = true; };
    event.userChoice = Promise.resolve({ outcome });
    return event;
};

const buttons = banner => banner.children.find(c => c.className === 'ip-install__actions').children;

test('the service worker is registered once the page has loaded', () => {
    const b = browser();
    assert.deepEqual(b.registered, []);
    b.fire('load');
    assert.deepEqual(b.registered, ['/sw.js']);
});

test('an installable site shows our Install prompt, and Install opens the browser dialog', async () => {
    const b = browser();
    const event = installEvent('accepted');
    b.fire('beforeinstallprompt', event);
    assert.equal(event.prevented, true, "the browser's own mini bar is replaced");
    const banner = b.banner();
    assert.ok(banner, 'banner shown');
    assert.equal(banner.attributes['aria-label'], 'Install InternPilot');

    const [install, notNow] = buttons(banner);
    assert.equal(install.textContent, 'Install');
    assert.equal(notNow.textContent, 'Not now');
    install.click();
    assert.equal(event.prompted, true);
    assert.equal(b.banner(), null, 'banner closes');
    await event.userChoice;
    await new Promise(r => setImmediate(r));
    assert.equal(b.window.localStorage.getItem('internpilot:install-dismissed-at'), null, 'accepted: nothing to remember');
});

test('"Not now" hides the prompt for 30 days', () => {
    const local = new Map();
    const b = browser({ local });
    b.fire('beforeinstallprompt', installEvent());
    buttons(b.banner())[1].click();
    assert.equal(b.banner(), null);
    assert.ok(Number(local.get('internpilot:install-dismissed-at')) > 0);

    const later = browser({ local }); // a new visit, new session
    later.fire('beforeinstallprompt', installEvent());
    assert.equal(later.banner(), null, 'not shown again while dismissed');
});

test('the prompt shows at most once per session, and never inside the installed app', () => {
    const session = new Map();
    const first = browser({ session });
    first.fire('beforeinstallprompt', installEvent());
    assert.ok(first.banner());

    const nextPage = browser({ session }); // same session, next page
    nextPage.fire('beforeinstallprompt', installEvent());
    assert.equal(nextPage.banner(), null);

    const installed = browser({ standalone: true });
    installed.fire('beforeinstallprompt', installEvent());
    assert.equal(installed.banner(), null);
});

test('installing from the browser menu closes the prompt', () => {
    const b = browser();
    b.fire('beforeinstallprompt', installEvent());
    assert.ok(b.banner());
    b.fire('appinstalled');
    assert.equal(b.banner(), null);
});

test('iPhone users get the Add to Home Screen hint instead', () => {
    const b = browser({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/604.1' });
    b.fire('load');
    const banner = b.banner();
    assert.ok(banner);
    const text = banner.children.find(c => c.className === 'ip-install__text').children[1].textContent;
    assert.match(text, /Add to Home Screen/);
    const actions = buttons(banner);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].textContent, 'Got it');
});

test('blocked storage (private mode) does not break the prompt', () => {
    const b = browser();
    const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    b.window.localStorage = throwing;
    b.window.sessionStorage = throwing;
    assert.doesNotThrow(() => b.fire('beforeinstallprompt', installEvent()));
    assert.ok(b.banner());
    assert.doesNotThrow(() => buttons(b.banner())[1].click());
});
