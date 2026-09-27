/*
 * InternPilot motion layer (#211).
 *
 * Progressive enhancement only: every page works the same without it.
 *
 * - Flash messages become toasts in the corner. They slide in, close on their
 *   own after a few seconds (paused while hovered or focused), and can be
 *   closed early. Other scripts can raise one with InternPilotMotion.toast().
 * - Elements marked data-animate ("fade-up", "fade-in", "scale-in") and the
 *   children of data-animate-stagger containers are revealed as they scroll
 *   into view, and data-count-up numbers count up to their value. These use
 *   Motion, the plain JavaScript version of Framer Motion, loaded from a CDN
 *   only on pages that have something to animate.
 * - data-tilt cards lean slightly toward the pointer on devices with a mouse.
 * - Forms with data-confirm="Question?" ask in an accessible dialog (native
 *   <dialog>: focus stays inside, Escape cancels) instead of the browser's
 *   confirm() box. Scripts can use InternPilotMotion.confirm() the same way.
 *
 * With prefers-reduced-motion everything is shown straight away and nothing moves.
 */
(function (factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else if (typeof window !== 'undefined' && typeof document !== 'undefined') api.start(window, document);
})(function () {
    'use strict';

    // Pinned, with Subresource Integrity, so a changed CDN file is refused.
    const MOTION_SRC = 'https://cdn.jsdelivr.net/npm/motion@12.43.0/dist/motion.js';
    const MOTION_SRI = 'sha384-hgVFh5YKDMdpcWEjpRqk2kPXOKBH7I9NBCKe3uR6dHKgy/BWPe8kyL01kiYuRn1u';

    const EASE_OUT = [0.22, 1, 0.36, 1];
    const REVEALS = {
        'fade-up': { opacity: [0, 1], y: [10, 0] },
        'fade-in': { opacity: [0, 1] },
        'scale-in': { opacity: [0, 1], scale: [0.98, 1] }
    };
    // Reveals stay quick, and long lists only animate their first few items,
    // so nothing ever waits on an animation to be readable.
    const REVEAL_SECONDS = 0.3;
    const MAX_STAGGERED = 12;
    const STAGGER_TOTAL_SECONDS = 0.36;
    // Errors stay up longer: they usually need reading and acting on.
    const TOAST_MS = { success: 5000, error: 9000 };
    // Start as soon as anything is on screen, so nothing visible sits blank.
    const IN_VIEW = { margin: '0px 0px -2% 0px' };
    const ANIMATED_SELECTOR = '[data-animate], [data-animate-stagger], [data-count-up]';

    // --- pure helpers (unit tested) ---

    /** Splits "₹12,500/month" into the number and the text around it. */
    function parseCount(text) {
        const value = String(text == null ? '' : text);
        const match = value.match(/-?\d[\d,]*(?:\.(\d+))?/);
        if (!match) return null;
        const target = Number(match[0].replace(/,/g, ''));
        if (!Number.isFinite(target)) return null;
        return {
            target,
            decimals: match[1] ? match[1].length : 0,
            prefix: value.slice(0, match.index),
            suffix: value.slice(match.index + match[0].length)
        };
    }

    function formatCount(parts, current) {
        const number = Number(current).toLocaleString('en-IN', {
            minimumFractionDigits: parts.decimals,
            maximumFractionDigits: parts.decimals
        });
        return `${parts.prefix}${number}${parts.suffix}`;
    }

    /** x and y: pointer position across the card, -0.5 to 0.5. */
    function tiltTransform(x, y, maxDeg = 6) {
        const clamp = v => Math.max(-0.5, Math.min(0.5, Number(v) || 0));
        const rotateX = (-clamp(y) * maxDeg * 2).toFixed(2);
        const rotateY = (clamp(x) * maxDeg * 2).toFixed(2);
        return `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    }

    function toastType(element) {
        return /rose|red|error|warning/i.test(String((element && element.className) || '')) ? 'error' : 'success';
    }

    /** "Sign In to Apply", "Quick Apply", "Tailor Application", "Prepare Application Kit": yes. "My Applications": no. */
    function isApplyAction(text) {
        return /\bapply\b|tailor application|application kit/i.test(String(text || ''));
    }

    // --- Motion loading ---

    let motionPromise = null;
    function loadMotion(win, doc) {
        if (win.Motion) return Promise.resolve(win.Motion);
        if (!motionPromise) {
            motionPromise = new Promise((resolve, reject) => {
                const script = doc.createElement('script');
                script.src = MOTION_SRC;
                script.integrity = MOTION_SRI;
                script.crossOrigin = 'anonymous';
                script.async = true;
                script.onload = () => (win.Motion ? resolve(win.Motion) : reject(new Error('Motion did not load')));
                script.onerror = () => reject(new Error('Motion could not be loaded'));
                doc.head.appendChild(script);
            });
        }
        return motionPromise;
    }

    // --- toasts ---

    function toastRegion(doc) {
        let region = doc.getElementById('ip-toasts');
        if (!region) {
            region = doc.createElement('div');
            region.id = 'ip-toasts';
            region.className = 'ip-toasts';
            doc.body.appendChild(region);
        }
        return region;
    }

    // A pausable countdown, with the shrinking bar when motion is allowed.
    function countdown(win, bar, duration, reduce, onDone) {
        if (!reduce && bar && typeof bar.animate === 'function') {
            const animation = bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration, easing: 'linear', fill: 'forwards' });
            animation.onfinish = onDone;
            return { pause: () => animation.pause(), resume: () => animation.play(), stop: () => animation.cancel() };
        }
        let remaining = duration;
        let startedAt = Date.now();
        let handle = win.setTimeout(onDone, remaining);
        return {
            pause() { win.clearTimeout(handle); remaining -= Date.now() - startedAt; },
            resume() { startedAt = Date.now(); handle = win.setTimeout(onDone, Math.max(0, remaining)); },
            stop() { win.clearTimeout(handle); }
        };
    }

    function showToast(win, doc, toast, type, reduce) {
        const region = toastRegion(doc);
        toast.classList.add('ip-toast');
        const bar = doc.createElement('span');
        bar.className = 'ip-toast__timer';
        bar.setAttribute('aria-hidden', 'true');
        toast.appendChild(bar);
        region.appendChild(toast);

        if (!reduce && typeof toast.animate === 'function') {
            toast.animate(
                [{ opacity: 0, transform: 'translateY(-10px) scale(0.98)' }, { opacity: 1, transform: 'none' }],
                { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
            );
        }

        let closed = false;
        let timer = null;
        const close = () => {
            if (closed) return;
            closed = true;
            if (timer) timer.stop();
            if (reduce || typeof toast.animate !== 'function') return toast.remove();
            const out = toast.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-6px)' }], { duration: 180, easing: 'ease-in' });
            out.onfinish = () => toast.remove();
            return undefined;
        };
        timer = countdown(win, bar, TOAST_MS[type] || TOAST_MS.success, reduce, close);

        const pause = () => { if (!closed) timer.pause(); };
        const resume = () => { if (!closed) timer.resume(); };
        toast.addEventListener('mouseenter', pause);
        toast.addEventListener('mouseleave', resume);
        toast.addEventListener('focusin', pause);
        toast.addEventListener('focusout', resume);

        const button = toast.querySelector('button');
        if (button) {
            button.removeAttribute('onclick');
            button.addEventListener('click', close);
        }
        return { close };
    }

    // Same look as the flash partial, for toasts raised from scripts.
    function buildToast(doc, message, type) {
        const error = type === 'error';
        const toast = doc.createElement('div');
        toast.setAttribute('role', error ? 'alert' : 'status');
        toast.className = `flex items-center justify-between gap-3 p-4 rounded-xl border shadow-sm ${error ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`;
        const text = doc.createElement('span');
        text.className = 'text-xs sm:text-sm font-medium';
        text.textContent = String(message || '');
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'p-1 rounded-md opacity-70 hover:opacity-100';
        button.setAttribute('aria-label', 'Close');
        button.textContent = '×';
        toast.appendChild(text);
        toast.appendChild(button);
        return toast;
    }

    // Flash messages rendered by the server become toasts. Each is moved as a
    // copy, so the flash partial's own six-second timer (which holds the
    // original) finds it detached and does nothing.
    function toastifyFlash(win, doc, reduce) {
        doc.querySelectorAll('[data-flash-alert]').forEach(original => {
            const wrapper = original.parentElement;
            const toast = original.cloneNode(true);
            toast.removeAttribute('data-flash-alert');
            toast.setAttribute('data-toast', '');
            original.remove();
            if (wrapper && wrapper.children.length === 0) wrapper.remove();
            showToast(win, doc, toast, toastType(original), reduce);
        });
    }

    // --- confirmation dialogs ---

    /**
     * Resolves true when confirmed. Uses a native <dialog> (focus trapped,
     * Escape cancels, focus returns afterwards) and falls back to confirm()
     * in browsers without it.
     */
    function confirmDialog(win, doc, reduce, { message, action = 'Confirm', tone = 'danger' } = {}) {
        if (typeof win.HTMLDialogElement !== 'function') return Promise.resolve(Boolean(win.confirm(message)));
        return new Promise(resolve => {
            const dialog = doc.createElement('dialog');
            dialog.className = `ip-dialog ip-dialog--${tone === 'danger' ? 'danger' : 'primary'}`;
            dialog.setAttribute('aria-labelledby', 'ip-dialog-message');

            const form = doc.createElement('form');
            form.setAttribute('method', 'dialog');
            const text = doc.createElement('p');
            text.id = 'ip-dialog-message';
            text.className = 'ip-dialog__message';
            text.textContent = String(message || 'Are you sure?');
            const actions = doc.createElement('div');
            actions.className = 'ip-dialog__actions';
            const cancel = doc.createElement('button');
            cancel.type = 'submit';
            cancel.value = 'cancel';
            cancel.className = 'ip-dialog__cancel';
            cancel.textContent = 'Cancel';
            cancel.autofocus = true; // the safe choice gets focus
            const ok = doc.createElement('button');
            ok.type = 'submit';
            ok.value = 'confirm';
            ok.className = 'ip-dialog__confirm';
            ok.textContent = String(action);
            actions.appendChild(cancel);
            actions.appendChild(ok);
            form.appendChild(text);
            form.appendChild(actions);
            dialog.appendChild(form);

            dialog.addEventListener('close', () => {
                resolve(dialog.returnValue === 'confirm');
                dialog.remove();
            });
            doc.body.appendChild(dialog);
            dialog.showModal();
            if (!reduce && typeof dialog.animate === 'function') {
                dialog.animate([{ opacity: 0, transform: 'translateY(8px) scale(0.97)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
            }
        });
    }

    // Any form with data-confirm asks first; the answer lets it submit as normal.
    function initConfirms(win, doc, reduce) {
        doc.addEventListener('submit', event => {
            const form = event.target;
            if (!form || typeof form.hasAttribute !== 'function' || !form.hasAttribute('data-confirm')) return;
            if (form.ipConfirmed) { form.ipConfirmed = false; return; }
            event.preventDefault();
            const submitter = event.submitter;
            confirmDialog(win, doc, reduce, {
                message: form.getAttribute('data-confirm'),
                action: form.getAttribute('data-confirm-action') || 'Confirm',
                tone: form.getAttribute('data-confirm-tone') || 'danger'
            }).then(confirmed => {
                if (!confirmed) return;
                form.ipConfirmed = true;
                if (typeof form.requestSubmit === 'function') form.requestSubmit(submitter || undefined);
                else form.submit();
            });
        }, true);
    }

    // --- floating Apply button on phones ---

    // On a phone the apply section sits far down a long page. A floating
    // button, labelled like the page's own apply action, jumps to it and hides
    // while the section is on screen. Nothing changes on larger screens, and
    // nothing appears when there is no apply action (applied, paused, owner).
    function initApplyJump(win, doc, reduce) {
        const section = doc.querySelector('[data-apply-card]');
        if (!section || !win.matchMedia || !win.matchMedia('(max-width: 767px)').matches) return;
        const action = Array.from(section.querySelectorAll('a[href], button'))
            .find(el => !el.disabled && el.getAttribute('aria-disabled') !== 'true' && isApplyAction(el.textContent));
        if (!action) return;

        if (!section.id) section.id = 'apply-section';
        const jump = doc.createElement('a');
        jump.href = `#${section.id}`;
        jump.className = 'ip-apply-jump';
        jump.textContent = String(action.textContent).replace(/\s+/g, ' ').trim();
        jump.addEventListener('click', event => {
            event.preventDefault();
            section.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
            if (typeof action.focus === 'function') action.focus({ preventScroll: true });
        });
        doc.body.appendChild(jump);
        if (typeof win.IntersectionObserver === 'function') {
            new win.IntersectionObserver(entries => {
                jump.classList.toggle('is-away', entries.some(entry => entry.isIntersecting));
            }).observe(section);
        }
    }

    // --- tilt ---

    function initTilt(win, doc, reduce) {
        if (reduce || !win.matchMedia || !win.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
        doc.querySelectorAll('[data-tilt]').forEach(card => {
            let frame = 0;
            card.addEventListener('pointerenter', () => { card.style.transition = 'transform 60ms linear, box-shadow 0.2s ease, border-color 0.2s ease'; });
            card.addEventListener('pointermove', event => {
                const box = card.getBoundingClientRect();
                const x = (event.clientX - box.left) / box.width - 0.5;
                const y = (event.clientY - box.top) / box.height - 0.5;
                win.cancelAnimationFrame(frame);
                frame = win.requestAnimationFrame(() => { card.style.transform = tiltTransform(x, y); });
            });
            card.addEventListener('pointerleave', () => {
                win.cancelAnimationFrame(frame);
                card.style.transition = '';
                card.style.transform = '';
            });
        });
    }

    // --- reveals and counters ---

    function runReveals(doc, Motion) {
        const { animate, inView, stagger } = Motion;

        doc.querySelectorAll('[data-animate-stagger]').forEach(container => {
            inView(container, () => {
                const items = Array.from(container.children).filter(el => !el.hasAttribute('data-animated'));
                if (!items.length) return;
                items.forEach(el => el.setAttribute('data-animated', ''));
                const animated = items.slice(0, MAX_STAGGERED);
                const gap = Math.min(0.04, STAGGER_TOTAL_SECONDS / animated.length);
                animate(animated, REVEALS['fade-up'], { duration: REVEAL_SECONDS, delay: stagger(gap), ease: EASE_OUT });
            }, IN_VIEW);
        });

        doc.querySelectorAll('[data-animate]').forEach(element => {
            inView(element, () => {
                if (element.hasAttribute('data-animated')) return;
                element.setAttribute('data-animated', '');
                animate(element, REVEALS[element.getAttribute('data-animate')] || REVEALS['fade-up'], { duration: REVEAL_SECONDS, ease: EASE_OUT });
            }, IN_VIEW);
        });

        doc.querySelectorAll('[data-count-up]').forEach(element => {
            const original = element.textContent;
            const parts = parseCount(original.trim());
            if (!parts || parts.target === 0) return;
            inView(element, () => {
                if (element.hasAttribute('data-counted')) return;
                element.setAttribute('data-counted', '');
                animate(0, parts.target, {
                    duration: 0.8,
                    ease: 'easeOut',
                    onUpdate: value => { element.textContent = formatCount(parts, value); },
                    // Always end on exactly what the server rendered.
                    onComplete: () => { element.textContent = original; }
                });
            });
        });
    }

    function initAnimations(win, doc, reduce) {
        const html = doc.documentElement;
        const reveal = () => html.classList.remove('motion-pending');
        if (reduce || !doc.querySelector(ANIMATED_SELECTOR)) return reveal();
        return loadMotion(win, doc)
            .then(Motion => {
                // If the head script already gave up waiting, content is showing: leave it be.
                if (!html.classList.contains('motion-pending')) return;
                runReveals(doc, Motion);
                win.__ipMotionReady = true;
            })
            .catch(reveal);
    }

    function start(win, doc) {
        const reduce = Boolean(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
        const api = win.InternPilotMotion = win.InternPilotMotion || {};
        api.toast = (message, type = 'success') => showToast(win, doc, buildToast(doc, message, type), type, reduce);
        api.confirm = (message, options = {}) => confirmDialog(win, doc, reduce, { ...options, message });
        api.loadMotion = () => loadMotion(win, doc);
        api.reducedMotion = reduce;
        initConfirms(win, doc, reduce);

        const ready = () => {
            toastifyFlash(win, doc, reduce);
            initApplyJump(win, doc, reduce);
            initTilt(win, doc, reduce);
            initAnimations(win, doc, reduce);
        };
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', ready);
        else ready();
        return api;
    }

    return { MOTION_SRC, MOTION_SRI, TOAST_MS, REVEALS, parseCount, formatCount, tiltTransform, toastType, isApplyAction, start };
});
