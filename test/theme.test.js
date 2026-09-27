const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const layout = fs.readFileSync(path.join(root, 'views', 'layouts', 'boilerplate.ejs'), 'utf8');
const header = fs.readFileSync(path.join(root, 'views', 'partials', 'header.ejs'), 'utf8');
const themeStyles = fs.readFileSync(path.join(root, 'public', 'css', 'theme.css'), 'utf8');

test('theme is selected before Tailwind loads and uses class-based dark mode', () => {
    assert.match(layout, /document\.documentElement\.classList\.toggle\('dark', isDark\)/);
    assert.match(layout, /darkMode:\s*'class'/);
    assert.ok(
        layout.indexOf("document.documentElement.classList.toggle('dark', isDark)")
            < layout.indexOf('https://cdn.tailwindcss.com'),
        'theme bootstrap should run before Tailwind so the page does not flash light'
    );
});

test('theme controller persists valid choices and supports both header controls', () => {
    assert.match(layout, /var modes = \['light', 'dark', 'system'\]/);
    assert.match(layout, /window\.localStorage\.setItem\(STORAGE_KEY, mode\)/);
    assert.match(layout, /\['themeToggle', 'themeToggleMobile'\]/);
    assert.match(layout, /mediaQuery\.addEventListener\('change'/);
    assert.doesNotMatch(header, /STORAGE_KEY/);
});

test('theme controls expose their current state to desktop and mobile users', () => {
    assert.match(header, /id="themeToggle"/);
    assert.match(header, /id="themeToggleMobile"/);
    assert.match(header, /themeToggleIcon/);
    assert.match(header, /themeToggleMobileIcon/);
    assert.match(layout, /Activate to switch to/);
});

test('shared theme stylesheet covers legacy neutral surfaces without replacing explicit dark utilities', () => {
    assert.match(themeStyles, /html\.dark \.bg-white:not\(\[class\*="dark:bg-"\]\)/);
    assert.match(themeStyles, /html\.dark \.text-slate-900:not\(\[class\*="dark:text-"\]\)/);
    assert.match(themeStyles, /html\.dark \.border-slate-200:not\(\[class\*="dark:border-"\]\)/);
    assert.match(themeStyles, /html\.dark input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/);
});
