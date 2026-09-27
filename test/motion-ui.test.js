const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const MODULE = path.join(root, 'public/js/motion-ui.js');

// A fresh copy of the module, so each test starts with Motion not yet loaded.
function freshMotionUi() {
    delete require.cache[require.resolve(MODULE)];
    return require(MODULE);
}

// --- a tiny DOM, just enough for the motion layer ---

class El {
    constructor(tag) {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.parentElement = null;
        this.attrs = {};
        this.className = '';
        this.textContent = '';
        this.listeners = {};
        this.style = {};
        this.id = '';
    }
    get classList() {
        const el = this;
        const list = () => el.className.split(/\s+/).filter(Boolean);
        return {
            add: c => { if (!list().includes(c)) el.className = [...list(), c].join(' '); },
            remove: c => { el.className = list().filter(x => x !== c).join(' '); },
            contains: c => list().includes(c)
        };
    }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    hasAttribute(k) { return k in this.attrs; }
    removeAttribute(k) { delete this.attrs[k]; }
    appendChild(child) {
        if (child.parentElement) child.remove();
        child.parentElement = this;
        this.children.push(child);
        return child;
    }
    remove() {
        if (!this.parentElement) return;
        this.parentElement.children = this.parentElement.children.filter(c => c !== this);
        this.parentElement = null;
    }
    cloneNode(deep) {
        const copy = new El(this.tagName);
        copy.attrs = { ...this.attrs };
        copy.className = this.className;
        copy.textContent = this.textContent;
        if (deep) this.children.forEach(c => copy.appendChild(c.cloneNode(true)));
        return copy;
    }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    fire(type, event = {}) { (this.listeners[type] || []).forEach(fn => fn(event)); }
    showModal() { this.open = true; }
    close(value) { this.returnValue = value; this.open = false; this.fire('close'); }
    all() { return [this, ...this.children.flatMap(c => c.all())]; }
    querySelectorAll(selector) {
        const parts = selector.split(',').map(s => s.trim());
        return this.all().slice(1).filter(el => parts.some(part => {
            // "tag", "[attr]" or "tag[attr]"
            const [, tag, attr] = part.match(/^([a-z]*)(?:\[([\w-]+)\])?$/i) || [];
            return (!tag || el.tagName === tag.toUpperCase()) && (!attr || el.hasAttribute(attr));
        }));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function browser({ reduce = false, phone = false } = {}) {
    const docListeners = {};
    const doc = { readyState: 'interactive', addEventListener: (type, fn) => { (docListeners[type] = docListeners[type] || []).push(fn); } };
    doc.dispatch = (type, event) => (docListeners[type] || []).forEach(fn => fn(event));
    doc.documentElement = new El('html');
    doc.head = doc.documentElement.appendChild(new El('head'));
    doc.body = doc.documentElement.appendChild(new El('body'));
    doc.createElement = tag => new El(tag);
    doc.getElementById = id => doc.documentElement.all().find(el => el.id === id) || null;
    doc.querySelectorAll = s => doc.documentElement.querySelectorAll(s);
    doc.querySelector = s => doc.documentElement.querySelector(s);
    doc.documentElement.classList.add('motion-pending');

    const timers = [];
    const win = {
        matchMedia: query => ({ matches: query.includes('reduce') ? reduce : (query.includes('max-width: 767px') ? phone : false) }),
        setTimeout: (fn, ms) => timers.push({ fn, ms, cleared: false }),
        clearTimeout: id => { if (timers[id - 1]) timers[id - 1].cleared = true; },
        requestAnimationFrame: () => 0,
        cancelAnimationFrame() {}
    };
    return { doc, win, timers };
}

function flashAlert(doc, kind, message) {
    const wrapper = doc.body.appendChild(new El('div'));
    wrapper.className = 'space-y-2 mb-6';
    const alert = wrapper.appendChild(new El('div'));
    alert.setAttribute('data-flash-alert', '');
    alert.setAttribute('role', 'alert');
    alert.className = kind === 'error' ? 'flex p-4 bg-rose-50 border-rose-200 text-rose-800' : 'flex p-4 bg-emerald-50 border-emerald-200 text-emerald-800';
    const text = alert.appendChild(new El('span'));
    text.textContent = message;
    const button = alert.appendChild(new El('button'));
    button.setAttribute('onclick', 'this.parentElement.remove()');
    return { wrapper, alert };
}

const toasts = doc => (doc.getElementById('ip-toasts') || { children: [] }).children;

// --- helpers ---

test('count-up keeps the text around the number and ends on the server value', () => {
    const { parseCount, formatCount } = freshMotionUi();
    assert.deepEqual(parseCount('₹12,500/month'), { target: 12500, decimals: 0, prefix: '₹', suffix: '/month' });
    assert.deepEqual(parseCount('72%'), { target: 72, decimals: 0, prefix: '', suffix: '%' });
    assert.deepEqual(parseCount('4.5 rating'), { target: 4.5, decimals: 1, prefix: '', suffix: ' rating' });
    assert.equal(parseCount('No data'), null);
    const parts = parseCount('₹1,25,000');
    assert.equal(formatCount(parts, 125000), '₹1,25,000', 'Indian digit grouping');
    assert.equal(formatCount(parseCount('4.5'), 2.25), '2.3');
});

test('tilt stays within a few degrees and toasts pick their type from the flash colour', () => {
    const { tiltTransform, toastType } = freshMotionUi();
    assert.equal(tiltTransform(0, 0), 'perspective(900px) rotateX(0.00deg) rotateY(0.00deg)');
    assert.equal(tiltTransform(0.5, -0.5), 'perspective(900px) rotateX(6.00deg) rotateY(6.00deg)');
    assert.equal(tiltTransform(9, 9), tiltTransform(0.5, 0.5), 'clamped at the card edge');
    assert.equal(toastType({ className: 'bg-rose-50 text-rose-800' }), 'error');
    assert.equal(toastType({ className: 'bg-emerald-50' }), 'success');
});

// --- behaviour ---

test('flash messages become toasts that close on their own, pause on hover and close on click', () => {
    const { doc, win, timers } = browser();
    const ok = flashAlert(doc, 'success', 'Profile saved.');
    const bad = flashAlert(doc, 'error', 'Invalid code.');
    freshMotionUi().start(win, doc);

    const list = toasts(doc);
    assert.equal(list.length, 2, 'both messages moved into the toast area');
    assert.equal(ok.alert.parentElement, null, 'the originals are gone, so the partial\'s old timer does nothing');
    assert.equal(ok.wrapper.parentElement, null, 'and their empty wrappers too');
    assert.equal(list[0].children[0].textContent, 'Profile saved.');
    assert.equal(list[1].hasAttribute('data-toast'), true);

    // Without Web Animations (as here) a timer closes each toast; errors stay longer.
    assert.deepEqual(timers.map(t => t.ms), [5000, 9000]);
    list[0].fire('mouseenter');
    assert.equal(timers[0].cleared, true, 'hovering pauses the countdown');
    list[0].fire('mouseleave');
    assert.equal(timers.length, 3, 'and leaving resumes it');

    timers[2].fn();
    assert.equal(toasts(doc).length, 1, 'the success toast closed itself');
    const closeButton = toasts(doc)[0].querySelector('button');
    assert.equal(closeButton.hasAttribute('onclick'), false);
    closeButton.fire('click');
    assert.equal(toasts(doc).length, 0, 'the close button works');
});

test('other scripts can raise a toast, and the message is text, never HTML', () => {
    const { doc, win } = browser();
    const api = freshMotionUi().start(win, doc);
    api.toast('<img src=x onerror=alert(1)> saved', 'success');
    const toast = toasts(doc)[0];
    assert.equal(toast.getAttribute('role'), 'status');
    assert.equal(toast.children[0].textContent, '<img src=x onerror=alert(1)> saved');
    assert.equal(toast.children[0].children.length, 0);
    api.toast('Could not save', 'error');
    assert.equal(toasts(doc)[1].getAttribute('role'), 'alert');
});

test('Motion is only loaded on pages with something to animate, pinned and integrity-checked', () => {
    const plain = browser();
    freshMotionUi().start(plain.win, plain.doc);
    assert.equal(plain.doc.head.querySelector('script'), null, 'nothing to animate: nothing loaded');
    assert.equal(plain.doc.documentElement.classList.contains('motion-pending'), false);

    const page = browser();
    page.doc.body.appendChild(new El('div')).setAttribute('data-animate', 'fade-up');
    const mod = freshMotionUi();
    mod.start(page.win, page.doc);
    const script = page.doc.head.querySelector('script');
    assert.ok(script, 'Motion requested');
    assert.equal(script.src, mod.MOTION_SRC);
    assert.match(script.src, /motion@\d+\.\d+\.\d+\/dist\/motion\.js$/, 'an exact version, never "latest"');
    assert.match(script.integrity, /^sha384-[A-Za-z0-9+/]{64}$/);
    assert.equal(script.crossOrigin, 'anonymous');
    assert.equal(page.doc.documentElement.classList.contains('motion-pending'), true, 'content waits for its reveal');

    script.onerror();
    return new Promise(resolve => setImmediate(resolve)).then(() => {
        assert.equal(page.doc.documentElement.classList.contains('motion-pending'), false, 'if Motion fails, everything is shown');
    });
});

test('with reduced motion nothing is loaded, nothing is hidden, and toasts still work', () => {
    const { doc, win } = browser({ reduce: true });
    doc.body.appendChild(new El('div')).setAttribute('data-animate', 'fade-up');
    doc.body.appendChild(new El('span')).setAttribute('data-count-up', '');
    flashAlert(doc, 'success', 'Saved.');
    const api = freshMotionUi().start(win, doc);
    assert.equal(api.reducedMotion, true);
    assert.equal(doc.head.querySelector('script'), null);
    assert.equal(doc.documentElement.classList.contains('motion-pending'), false);
    assert.equal(toasts(doc).length, 1);
});

// --- styles and wiring ---

test('page transitions, reveals and tilt switch off for reduced motion', () => {
    const css = read('public/css/motion-ui.css');
    const motionOk = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference)'));
    assert.match(motionOk, /@view-transition\s*{\s*navigation:\s*auto;/);
    assert.ok(css.indexOf('@view-transition') > css.indexOf('@media (prefers-reduced-motion: no-preference)'), 'page transitions only when motion is fine');
    assert.match(css, /body > header\s*{\s*view-transition-name:\s*ip-site-header;/);
    assert.match(css, /\.motion-pending \[data-animate\]:not\(\[data-animated\]\)/, 'only content still waiting for its reveal is hidden');
    assert.match(css, /@media \(hover: hover\) and \(pointer: fine\) and \(prefers-reduced-motion: no-preference\)/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*{\s*\.ip-toast__timer/);
});

test('every page gets the motion layer early in <head>, with a safety net', async () => {
    const layout = read('views/layouts/boilerplate.ejs');
    const include = layout.indexOf("include('../partials/motion-head')");
    assert.ok(include > layout.indexOf('<meta charset="UTF-8">') && include < layout.indexOf('</head>'));

    const html = await ejs.renderFile(path.join(root, 'views/partials/motion-head.ejs'), {});
    assert.match(html, /<link rel="stylesheet" href="\/css\/motion-ui\.css">/);
    assert.match(html, /<script src="\/js\/motion-ui\.js" defer><\/script>/);
    assert.match(html, /prefers-reduced-motion: reduce/);
    assert.match(html, /setTimeout\([\s\S]*__ipMotionReady[\s\S]*motion-pending/, 'content is shown after a short wait even if the script never runs');
});

test('shared shell behavior is served from deferred assets instead of inline layout code', () => {
    const layout = read('views/layouts/boilerplate.ejs');
    const styles = read('public/css/app-shell.css');
    const script = read('public/js/app-shell.js');

    assert.match(layout, /<link rel="stylesheet" href="\/css\/app-shell\.css">/);
    assert.match(layout, /<script src="\/js\/app-shell\.js" defer><\/script>/);
    assert.doesNotMatch(layout, /<style>/);
    assert.doesNotMatch(layout, /include\('\.\.\/partials\/loading-script'\)/);
    assert.match(styles, /#back-to-top-btn\.visible/);
    assert.match(styles, /\.invisible-scrollbar::-webkit-scrollbar/);
    assert.match(script, /addEventListener\('submit'/);
    assert.match(script, /prefers-reduced-motion: reduce/);
});

// --- confirmation dialogs ---

function formWithConfirm(doc, question) {
    const form = doc.body.appendChild(new El('form'));
    form.setAttribute('data-confirm', question);
    form.setAttribute('data-confirm-action', 'Remove');
    form.submitted = 0;
    form.requestSubmit = () => submit(doc, form);
    return form;
}

function submit(doc, form) {
    const event = { target: form, submitter: null, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    doc.dispatch('submit', event);
    if (!event.defaultPrevented) form.submitted += 1;
    return event;
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test('forms with data-confirm ask first, and only submit when confirmed (confirm() fallback)', async () => {
    const { doc, win } = browser();
    const asked = [];
    let answer = false;
    win.confirm = question => { asked.push(question); return answer; };
    freshMotionUi().start(win, doc);
    const form = formWithConfirm(doc, 'Remove this announcement?');

    assert.equal(submit(doc, form).defaultPrevented, true);
    await tick();
    assert.deepEqual(asked, ['Remove this announcement?']);
    assert.equal(form.submitted, 0, 'cancelled: nothing sent');

    answer = true;
    submit(doc, form);
    await tick();
    assert.equal(form.submitted, 1, 'confirmed: the form submits as normal');
});

test('the dialog shows the question as text, focuses Cancel, and Cancel or Escape keep the form unsent', async () => {
    const { doc, win } = browser();
    win.HTMLDialogElement = function HTMLDialogElement() {};
    freshMotionUi().start(win, doc);
    const form = formWithConfirm(doc, '<b>Suspend</b> this company?');

    submit(doc, form);
    let dialog = doc.body.querySelector('dialog');
    assert.ok(dialog && dialog.open, 'a modal dialog opened');
    assert.equal(doc.getElementById('ip-dialog-message').textContent, '<b>Suspend</b> this company?');
    const [cancel, confirmButton] = dialog.querySelectorAll('button');
    assert.equal(cancel.autofocus, true, 'the safe choice has focus');
    assert.equal(confirmButton.textContent, 'Remove');
    dialog.close(''); // Escape
    await tick();
    assert.equal(form.submitted, 0);
    assert.equal(doc.body.querySelector('dialog'), null, 'the dialog is removed afterwards');

    submit(doc, form);
    dialog = doc.body.querySelector('dialog');
    dialog.close('confirm');
    await tick();
    assert.equal(form.submitted, 1);
});

test('admin pages use the motion layer and the dialog, never the browser confirm box', () => {
    const view = name => read(`views/${name}.ejs`);
    const overview = view('admin-console/overview');
    assert.equal((overview.match(/data-animate-stagger/g) || []).length, 3, 'KPI tiles and both card rows');
    assert.match(overview, /data-count-up><%= stat\.current %>/);
    for (const name of ['users', 'applications', 'audit-log']) {
        assert.match(view(`admin-console/${name}`), /<tbody[^>]*data-animate-stagger/, `${name} rows animate in`);
    }
    assert.match(view('admin-console/listings'), /data-animate-stagger/);
    const announcements = view('admin-console/announcements');
    assert.match(announcements, /data-confirm="Remove this announcement\?[^"]*" data-confirm-action="Remove"/);

    const dashboard = view('admin/dashboard');
    assert.equal((dashboard.match(/data-count-up/g) || []).length, 3);
    assert.match(dashboard, /data-confirm="Suspend this company[^"]*" data-confirm-action="Suspend"/);

    for (const name of ['admin/dashboard', 'admin-console/announcements', 'admin-console/listings', 'admin-console/users', 'admin-console/overview']) {
        assert.doesNotMatch(view(name), /confirm\(/, `${name} has no confirm() left`);
    }

    const sidebar = view('admin-console/partials/sidebar');
    assert.match(sidebar, /view-transition-name: ip-console-nav/);
    assert.match(sidebar, /view-transition-name: ip-console-active/, 'the active item glides between sections');
});

// --- phase 3: candidate pages and the 3D plane ---

function applySection(doc, label, { disabled = false, tag = 'a' } = {}) {
    const section = doc.body.appendChild(new El('div'));
    section.setAttribute('data-apply-card', '');
    const action = section.appendChild(new El(tag));
    if (tag === 'a') action.setAttribute('href', '/auth/login');
    action.textContent = label;
    action.disabled = disabled;
    action.scrollIntoView = () => {};
    section.scrollIntoView = () => { section.scrolled = true; };
    return section;
}

const jumpButton = doc => doc.body.children.find(el => el.className === 'ip-apply-jump') || null;

test('phones get a floating Apply button labelled like the page\'s own apply action', () => {
    const { isApplyAction } = freshMotionUi();
    for (const label of ['Sign In to Apply', 'Quick Apply', 'Tailor Application', 'Prepare Application Kit']) assert.equal(isApplyAction(label), true, label);
    for (const label of ['My Applications', 'Applications Temporarily Paused', 'Edit Listing']) assert.equal(isApplyAction(label), false, label);

    const phone = browser({ phone: true });
    const section = applySection(phone.doc, '  Sign In to Apply  ');
    freshMotionUi().start(phone.win, phone.doc);
    const jump = jumpButton(phone.doc);
    assert.ok(jump, 'shown on a phone');
    assert.equal(jump.textContent, 'Sign In to Apply');
    assert.equal(jump.href, '#apply-section');
    jump.fire('click', { preventDefault() {} });
    assert.equal(section.scrolled, true, 'it takes you to the apply section');

    const desktop = browser();
    applySection(desktop.doc, 'Quick Apply', { tag: 'button' });
    freshMotionUi().start(desktop.win, desktop.doc);
    assert.equal(jumpButton(desktop.doc), null, 'nothing on larger screens');

    const paused = browser({ phone: true });
    applySection(paused.doc, 'Quick Apply', { tag: 'button', disabled: true });
    freshMotionUi().start(paused.win, paused.doc);
    assert.equal(jumpButton(paused.doc), null, 'nothing when applying is paused');
});

test('the 3D plane only renders where it costs nothing: WebGL, 4G, no Data Saver, motion allowed', async () => {
    const { canRender3d } = await import('../public/js/plane-3d.mjs');
    assert.equal(canRender3d({ webgl: true, effectiveType: '4g' }), true);
    assert.equal(canRender3d({ webgl: true }), true, 'unknown connection counts as fine');
    assert.equal(canRender3d({ webgl: false }), false);
    assert.equal(canRender3d({ webgl: true, saveData: true }), false);
    assert.equal(canRender3d({ webgl: true, reduceMotion: true }), false);
    for (const slow of ['slow-2g', '2g', '3g']) assert.equal(canRender3d({ webgl: true, effectiveType: slow }), false, slow);

    const source = read('public/js/plane-3d.mjs');
    assert.match(source, /three@\d+\.\d+\.\d+\/build\/three\.module\.min\.js/, 'Three.js is pinned to an exact version');
    assert.match(source, /const THREE_SRI = 'sha384-[A-Za-z0-9+/]{64}'/);
    assert.match(source, /crypto\.subtle\.digest\('SHA-384'/, 'and checked before it runs');
    assert.match(source, /IntersectionObserver[\s\S]*visibilitychange/, 'it pauses off screen and in hidden tabs');
});

test('the plane partial shows the logo until the 3D version is ready', async () => {
    const file = path.join(root, 'views/partials/plane-3d.ejs');
    const html = await ejs.renderFile(file, {});
    assert.match(html, /<div class="ip-plane3d" data-plane-3d>/);
    assert.match(html, /<img src="\/images\/internpilot-logo\.svg" alt="" class="ip-plane3d__fallback"/);
    assert.match(html, /<script type="module" src="\/js\/plane-3d\.mjs"><\/script>/);
    assert.match(await ejs.renderFile(file, { size: 'lg' }), /class="ip-plane3d ip-plane3d--lg"/);
    const css = read('public/css/motion-ui.css');
    assert.match(css, /\.ip-plane3d\.is-3d \.ip-plane3d__fallback\s*{\s*opacity: 0;/);
});

test('candidate pages use the motion layer, and empty states get the 3D plane', () => {
    const view = name => read(`views/${name}.ejs`);
    const tracker = view('candidate/candidate-tracker');
    assert.match(tracker, /<%- include\('\.\.\/partials\/plane-3d'\) %>\s*<h2[^>]*>No applications submitted yet/);
    assert.match(tracker, /aria-label="Submitted applications" data-animate-stagger/);

    const saved = view('candidate/saved-internships');
    assert.match(saved, /<%- include\('\.\.\/partials\/plane-3d'\) %>\s*<h3[^>]*>No Saved Internships/);
    assert.match(saved, /id="saved-grid" data-animate-stagger/);
    assert.match(saved, /<div data-tilt\s+class="internship-card/);

    const list = view('extras/internships');
    assert.match(list, /gap-6" data-animate-stagger>\s*<% internships\.forEach/);
    assert.match(list, /<div data-tilt\s+class="internship-card/);

    const detail = view('extras/internship-detail');
    assert.match(detail, /space-y-6" data-animate-stagger>/);
    assert.match(detail, /Candidate \/ Student Action Area -->\s*<div data-apply-card>/);

    const recommendations = view('candidate/candidate-recommendations');
    assert.match(recommendations, /class="ip-ring" style="--ring-value: <%= ringScore %>;/, 'match scores are drawn as rings');
    assert.match(recommendations, /role="img" aria-label="<%= ringScore %>% match"/, 'with a text alternative');
    assert.match(recommendations, /<span data-count-up><%= ringScore %>%<\/span>/);
    assert.match(view('candidate/candidate-tracker'), /<header class="ip-hero /);
    assert.match(view('candidate/saved-internships'), /<div class="ip-hero /);

    for (const name of ['candidate/candidate-tracker', 'candidate/saved-internships', 'extras/internships', 'extras/internship-detail', 'candidate/candidate-recommendations']) {
        const file = path.join(root, 'views', `${name}.ejs`);
        assert.doesNotThrow(() => ejs.compile(read(`views/${name}.ejs`).replace("<% layout('layouts/boilerplate') %>", ''), { filename: file }), `${name} compiles`);
    }
});
