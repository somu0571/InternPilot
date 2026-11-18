const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');





const VIEWS_DIR = path.join(__dirname, '..', 'views');


const JS_TYPES = ['', 'text/javascript', 'application/javascript'];

function listViews(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return listViews(full);
        return entry.name.endsWith('.ejs') ? [full] : [];
    });
}

function inlineScripts(file) {
    const source = fs.readFileSync(file, 'utf8');
    const scripts = [];
    const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = pattern.exec(source)) !== null) {
        const attrs = match[1];
        if (/\bsrc\s*=/.test(attrs)) continue;
        const type = ((attrs.match(/\btype\s*=\s*["']([^"']*)["']/i) || [])[1] || '').toLowerCase();
        if (!JS_TYPES.includes(type)) continue;
        scripts.push({
            line: source.slice(0, match.index).split('\n').length,
            body: match[2]
        });
    }
    return scripts;
}



function stripEjs(body) {
    return body
        .replace(/<%#[\s\S]*?%>/g, '')
        .replace(/<%[=-][\s\S]*?%>/g, 'null');
}

const views = listViews(VIEWS_DIR);

test('views directory has inline scripts to check', () => {
    const count = views.reduce((n, file) => n + inlineScripts(file).length, 0);
    assert.ok(count > 0);
});

for (const file of views) {
    const scripts = inlineScripts(file);
    if (!scripts.length) continue;

    test(`inline scripts parse: ${path.relative(VIEWS_DIR, file)}`, () => {
        scripts.forEach(({ line, body }) => {
            const code = stripEjs(body);
            assert.equal(/<%/.test(code), false,
                `${path.relative(VIEWS_DIR, file)}:${line} has EJS control flow inside a script, which this check cannot follow`);
            try {
                
                
                new vm.Script(code, { filename: `${file}:${line}` });
            } catch (err) {
                assert.fail(`${path.relative(VIEWS_DIR, file)}:${line}: ${err.message}`);
            }
        });
    });
}
