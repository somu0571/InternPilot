/*
 * Registers the service worker and shows a small "Install app" prompt (#195).
 *
 * Chrome, Edge and Samsung Internet fire `beforeinstallprompt` when the site
 * can be installed; we hold on to it and offer an Install button instead of
 * the browser's mini bar. iPhone and iPad have no such event, so Safari users
 * get a one-line hint about "Add to Home Screen" instead.
 *
 * The prompt shows at most once per browser session, never inside the
 * installed app, and "Not now" hides it for 30 days.
 */
(function () {
    'use strict';

    if (!('serviceWorker' in navigator)) return;

    window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js').catch(function (err) {
            console.warn('InternPilot: service worker registration failed', err);
        });
    });

    var DISMISS_KEY = 'internpilot:install-dismissed-at';
    var SHOWN_KEY = 'internpilot:install-shown';
    var DISMISS_FOR_MS = 30 * 24 * 60 * 60 * 1000;
    var banner = null;
    var deferredPrompt = null;

    function read(storage, key) {
        try {
            return window[storage].getItem(key);
        } catch (err) {
            return null; // storage blocked (private mode, strict settings)
        }
    }

    function write(storage, key, value) {
        try {
            window[storage].setItem(key, value);
        } catch (err) {
            // storage blocked: the prompt simply may show again next time
        }
    }

    function dismissedRecently() {
        var at = Number(read('localStorage', DISMISS_KEY));
        return Boolean(at) && Date.now() - at < DISMISS_FOR_MS;
    }

    function isStandalone() {
        var media = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
        return Boolean(media) || window.navigator.standalone === true;
    }

    function isIos() {
        return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    }

    function injectStyles() {
        if (document.getElementById('ip-install-style')) return;
        var style = document.createElement('style');
        style.id = 'ip-install-style';
        style.textContent = [
            '.ip-install{position:fixed;left:76px;right:12px;bottom:12px;z-index:60;display:flex;flex-wrap:wrap;align-items:center;gap:10px 12px;padding:12px;background:#fff;color:#0f172a;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 10px 30px rgba(15,23,42,.18);font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
            '.ip-install img{flex:none;border-radius:10px}',
            '.ip-install__text{display:flex;flex-direction:column;flex:1;min-width:0}',
            '.ip-install__text strong{font-size:14px}',
            '.ip-install__text span{font-size:12px;color:#475569}',
            '.ip-install__actions{display:flex;gap:6px;width:100%;justify-content:flex-end}',
            '.ip-install button{border:0;border-radius:8px;padding:8px 12px;font:600 13px/1 inherit;cursor:pointer}',
            '.ip-install__primary{background:#4f46e5;color:#fff}',
            '.ip-install__primary:hover{background:#4338ca}',
            '.ip-install__secondary{background:transparent;color:#475569}',
            '.ip-install button:focus-visible{outline:3px solid #818cf8;outline-offset:2px}',
            '@media (min-width:640px){.ip-install{left:auto;right:24px;bottom:24px;max-width:440px;flex-wrap:nowrap}.ip-install__actions{width:auto}}',
            'html.dark .ip-install{background:#0f172a;color:#e2e8f0;border-color:#1e293b}',
            'html.dark .ip-install__text span,html.dark .ip-install__secondary{color:#94a3b8}'
        ].join('\n');
        document.head.appendChild(style);
    }

    function hideBanner() {
        if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
        banner = null;
    }

    function dismiss() {
        write('localStorage', DISMISS_KEY, String(Date.now()));
        hideBanner();
    }

    function makeButton(label, className, onClick) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = label;
        button.addEventListener('click', onClick);
        return button;
    }

    // options: { text, installLabel, onInstall }
    function showBanner(options) {
        if (banner || isStandalone() || dismissedRecently() || read('sessionStorage', SHOWN_KEY)) return;
        write('sessionStorage', SHOWN_KEY, '1');
        injectStyles();

        banner = document.createElement('div');
        banner.className = 'ip-install';
        banner.setAttribute('role', 'region');
        banner.setAttribute('aria-label', 'Install InternPilot');

        var icon = document.createElement('img');
        icon.src = '/icons/icon-192.png';
        icon.alt = '';
        icon.width = 40;
        icon.height = 40;

        var text = document.createElement('div');
        text.className = 'ip-install__text';
        var title = document.createElement('strong');
        title.textContent = 'Install InternPilot';
        var detail = document.createElement('span');
        detail.textContent = options.text;
        text.appendChild(title);
        text.appendChild(detail);

        var actions = document.createElement('div');
        actions.className = 'ip-install__actions';
        if (options.installLabel) {
            actions.appendChild(makeButton(options.installLabel, 'ip-install__primary', options.onInstall));
        }
        actions.appendChild(makeButton(options.installLabel ? 'Not now' : 'Got it', 'ip-install__secondary', dismiss));

        banner.appendChild(icon);
        banner.appendChild(text);
        banner.appendChild(actions);
        banner.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') dismiss();
        });
        document.body.appendChild(banner);
    }

    window.addEventListener('beforeinstallprompt', function (event) {
        event.preventDefault();
        deferredPrompt = event;
        showBanner({
            text: 'Add it to your home screen for quick access, even on slow networks.',
            installLabel: 'Install',
            onInstall: function () {
                var prompt = deferredPrompt;
                deferredPrompt = null;
                hideBanner();
                if (!prompt) return;
                prompt.prompt();
                if (prompt.userChoice && typeof prompt.userChoice.then === 'function') {
                    prompt.userChoice.then(function (choice) {
                        if (!choice || choice.outcome !== 'accepted') write('localStorage', DISMISS_KEY, String(Date.now()));
                    }).catch(function () {});
                }
            }
        });
    });

    window.addEventListener('appinstalled', function () {
        deferredPrompt = null;
        hideBanner();
    });

    // iPhone and iPad have no install event, so explain the manual steps once.
    if (isIos() && !isStandalone()) {
        window.addEventListener('load', function () {
            showBanner({ text: 'Tap the Share button, then "Add to Home Screen".' });
        });
    }
})();
