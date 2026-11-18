const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejsMate = require('ejs-mate');

const footerPath = path.join(__dirname, '..', 'views', 'partials', 'footer.ejs');

test('footer template exists and contains valid markup', () => {
    assert.ok(fs.existsSync(footerPath), 'footer.ejs must exist');
    const content = fs.readFileSync(footerPath, 'utf8');
    assert.ok(content.length > 0, 'footer.ejs must not be empty');
});

test('footer links do not contain any dead placeholders (# or empty hrefs)', () => {
    const content = fs.readFileSync(footerPath, 'utf8');

    
    const hrefMatches = [...content.matchAll(/href=["']([^"']*)["']/g)];
    assert.ok(hrefMatches.length > 0, 'footer must contain links');

    const hrefs = hrefMatches.map(m => m[1].trim());

    for (const href of hrefs) {
        assert.notEqual(href, '#', `Found broken placeholder href="#" in footer`);
        assert.notEqual(href, '', `Found empty href="" in footer`);
        assert.notEqual(href, 'javascript:void(0)', `Found javascript:void(0) in footer`);
        assert.ok(
            href.startsWith('/') || href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:'),
            `Href "${href}" must be a valid internal or external path`
        );
    }
});

test('footer does not use unlinked span elements as clickable placeholders', () => {
    const content = fs.readFileSync(footerPath, 'utf8');

    
    const pseudoLinkMatch = content.match(/<span[^>]*cursor-pointer[^>]*>(Privacy|Terms|Hyperlinking|About|Contact)<\/span>/i);
    assert.equal(
        pseudoLinkMatch,
        null,
        `Found span element pretending to be a link: ${pseudoLinkMatch ? pseudoLinkMatch[0] : ''}`
    );
});

test('footer covers all essential PMIS portal and policy links', () => {
    const content = fs.readFileSync(footerPath, 'utf8');
    const hrefMatches = [...content.matchAll(/href=["']([^"']*)["']/g)].map(m => m[1].trim());

    const expectedRoutes = [
        '/',
        '/about',
        '/internships',
        '/guidelines',
        '/contact',
        '/grievance',
        '/privacy',
        '/terms',
        '/hyperlinking'
    ];

    for (const route of expectedRoutes) {
        assert.ok(
            hrefMatches.includes(route),
            `Expected footer to link to "${route}", but it was not found.`
        );
    }
});

test('all required view templates for footer routes exist in views/extras', () => {
    const requiredViews = [
        'about.ejs',
        'guidelines.ejs',
        'contact.ejs',
        'grievance.ejs',
        'privacy.ejs',
        'terms.ejs',
        'hyperlinking.ejs'
    ];

    const extrasDir = path.join(__dirname, '..', 'views', 'extras');

    for (const view of requiredViews) {
        const filePath = path.join(extrasDir, view);
        assert.ok(
            fs.existsSync(filePath),
            `View template ${view} must exist in views/extras/`
        );
    }
});

test('pages router defines and exports all footer route handlers', () => {
    const pagesRouter = require('../routes/pages');
    assert.ok(pagesRouter, 'routes/pages.js must export an Express router');

    
    const registeredPaths = pagesRouter.stack
        .filter(layer => layer.route)
        .flatMap(layer => Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path]);

    const requiredPaths = [
        '/about',
        '/guidelines',
        '/contact',
        '/grievance',
        '/privacy',
        '/terms',
        '/hyperlinking',
        '/directory'
    ];

    for (const p of requiredPaths) {
        assert.ok(
            registeredPaths.includes(p),
            `Router in routes/pages.js must handle "${p}"`
        );
    }
});

test('footer pages render without errors with ejsMate and boilerplate layout', async () => {
    const views = ['about', 'guidelines', 'contact', 'grievance', 'privacy', 'terms', 'hyperlinking'];
    const viewsDir = path.join(__dirname, '..', 'views');

    for (const viewName of views) {
        const filePath = path.join(viewsDir, 'extras', `${viewName}.ejs`);
        const html = await new Promise((resolve, reject) => {
            ejsMate(
                filePath,
                {
                    settings: { views: viewsDir },
                    currentUser: null,
                    notificationUnreadCount: 0,
                    success_msg: [],
                    error_msg: [],
                    error: []
                },
                (err, str) => {
                    if (err) return reject(err);
                    resolve(str);
                }
            );
        });

        assert.ok(html && html.length > 0, `${viewName}.ejs must render non-empty HTML`);
        assert.ok(html.includes('<!DOCTYPE html>'), `${viewName}.ejs must include boilerplate layout`);
    }
});
