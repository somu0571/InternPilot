/*
 * InternPilot service worker (#195).
 *
 * - Static files (our /css, /js, /images and /icons folders, and the CDN
 *   scripts, styles and fonts the layout loads) are served from the cache and
 *   refreshed in the background, so repeat visits load fast on slow networks.
 * - Pages always come from the network and are never cached, so nothing
 *   personal is stored on the device. When the network is down, the offline
 *   page is shown instead of the browser's error page.
 * - Everything else (form posts, API calls, /uploads with people's resumes,
 *   other sites) is left to the browser untouched.
 *
 * Bump VERSION whenever this file or the precached files change; the old
 * cache is removed when the new worker activates.
 */
'use strict';

const VERSION = 'v1';
const CACHE_PREFIX = 'internpilot-';
const STATIC_CACHE = `${CACHE_PREFIX}static-${VERSION}`;
const OFFLINE_URL = '/offline.html';
const MAX_STATIC_ENTRIES = 80;

// What the offline page and the app icon need without a network.
const PRECACHE_URLS = [OFFLINE_URL, '/manifest.webmanifest', '/icons/icon-192.png', '/images/internpilot-logo.svg'];

// Third-party hosts the layout loads scripts, styles and fonts from.
const CDN_HOSTS = new Set([
    'cdn.tailwindcss.com',
    'unpkg.com',
    'cdn.jsdelivr.net',
    'cdnjs.cloudflare.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com'
]);

// Our own static folders. /uploads is deliberately missing: it holds people's
// resumes and other files, which must never be kept on the device.
const STATIC_PATH = /^\/(css|js|images|icons)\//;

/** Decides how a request is handled: 'page', 'static' or 'bypass'. */
function strategyFor(request, origin) {
    if (!request || request.method !== 'GET') return 'bypass';
    let url;
    try {
        url = new URL(request.url);
    } catch (err) {
        return 'bypass';
    }

    if (url.origin === origin) {
        if (request.mode === 'navigate') return 'page';
        if (url.pathname === '/sw.js') return 'bypass';
        if (STATIC_PATH.test(url.pathname) || url.pathname === OFFLINE_URL || url.pathname === '/manifest.webmanifest') {
            return 'static';
        }
        return 'bypass';
    }

    if (url.protocol === 'https:' && CDN_HOSTS.has(url.hostname)) return 'static';
    return 'bypass';
}

function offlineFallback() {
    return new Response('You are offline. Check your connection and try again.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
}

/** Pages: network only, never cached; the offline page when the network fails. */
async function handlePage(request, { fetch, caches }) {
    try {
        return await fetch(request);
    } catch (err) {
        return (await caches.match(OFFLINE_URL)) || offlineFallback();
    }
}

/** Opaque responses come from CDN files loaded with plain script/link tags. */
function cacheable(response) {
    return Boolean(response) && (response.ok || response.type === 'opaque');
}

async function trimCache(cache, maxEntries) {
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - maxEntries; i += 1) {
        await cache.delete(keys[i]);
    }
}

/** Static files: cached copy first, refreshed in the background. */
async function handleStatic(request, { fetch, caches, waitUntil }) {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);

    const refresh = fetch(request).then(async response => {
        if (cacheable(response)) {
            await cache.put(request, response.clone());
            await trimCache(cache, MAX_STATIC_ENTRIES);
        }
        return response;
    });

    if (cached) {
        const background = refresh.catch(() => undefined);
        if (waitUntil) waitUntil(background);
        return cached;
    }
    return refresh;
}

async function precache({ caches }) {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(PRECACHE_URLS);
}

/** Removes caches left by older versions of this worker, and only ours. */
async function removeOldCaches({ caches }) {
    const names = await caches.keys();
    await Promise.all(
        names
            .filter(name => name.startsWith(CACHE_PREFIX) && name !== STATIC_CACHE)
            .map(name => caches.delete(name))
    );
}

// Browser only: the tests load this file in Node, where there is no `self`.
if (typeof module === 'undefined' && typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
    const deps = () => ({ fetch: (...args) => self.fetch(...args), caches: self.caches });

    self.addEventListener('install', event => {
        event.waitUntil(precache(deps()).then(() => self.skipWaiting()));
    });

    self.addEventListener('activate', event => {
        event.waitUntil(removeOldCaches(deps()).then(() => self.clients.claim()));
    });

    self.addEventListener('fetch', event => {
        const strategy = strategyFor(event.request, self.location.origin);
        if (strategy === 'page') {
            event.respondWith(handlePage(event.request, deps()));
        } else if (strategy === 'static') {
            event.respondWith(handleStatic(event.request, { ...deps(), waitUntil: promise => event.waitUntil(promise) }));
        }
    });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        VERSION,
        STATIC_CACHE,
        OFFLINE_URL,
        PRECACHE_URLS,
        CDN_HOSTS,
        MAX_STATIC_ENTRIES,
        strategyFor,
        handlePage,
        handleStatic,
        cacheable,
        precache,
        removeOldCaches
    };
}
