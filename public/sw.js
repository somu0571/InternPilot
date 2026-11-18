
'use strict';

const VERSION = 'v1';
const CACHE_PREFIX = 'internpilot-';
const STATIC_CACHE = `${CACHE_PREFIX}static-${VERSION}`;
const OFFLINE_URL = '/offline.html';
const MAX_STATIC_ENTRIES = 80;


const PRECACHE_URLS = [OFFLINE_URL, '/manifest.webmanifest', '/icons/icon-192.png', '/images/internpilot-logo.svg'];


const CDN_HOSTS = new Set([
    'cdn.tailwindcss.com',
    'unpkg.com',
    'cdn.jsdelivr.net',
    'cdnjs.cloudflare.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com'
]);



const STATIC_PATH = /^\/(css|js|images|icons)\


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


async function handlePage(request, { fetch, caches }) {
    try {
        return await fetch(request);
    } catch (err) {
        return (await caches.match(OFFLINE_URL)) || offlineFallback();
    }
}


function cacheable(response) {
    return Boolean(response) && (response.ok || response.type === 'opaque');
}

async function trimCache(cache, maxEntries) {
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - maxEntries; i += 1) {
        await cache.delete(keys[i]);
    }
}


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


async function removeOldCaches({ caches }) {
    const names = await caches.keys();
    await Promise.all(
        names
            .filter(name => name.startsWith(CACHE_PREFIX) && name !== STATIC_CACHE)
            .map(name => caches.delete(name))
    );
}


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
