const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const mongoose = require('mongoose');

// The stipend / duration row on each internship card (#145). It used to have
// a bullet between the two values that floated on its own in the middle of
// the row; spacing now comes from the flex gap.

const viewPath = path.join(__dirname, '..', 'views', 'extras', 'internships.ejs');
const template = fs.readFileSync(viewPath, 'utf8');

function renderCard(internship) {
    const html = ejs.render(template, {
        layout: () => undefined,
        currentUser: null,
        internships: [{
            _id: new mongoose.Types.ObjectId(),
            title: 'Full Stack Developer Intern',
            companyName: 'TechNova Solutions',
            location: { district: 'Pune', state: 'Maharashtra' },
            requiredSkills: ['React', 'Node.js'],
            ...internship
        }],
        queryState: {},
        currentFilter: 'all',
        pagination: null,
        sectors: [],
        appliedIds: []
    }, { filename: viewPath });

    // The row that holds the stipend and the duration.
    const start = html.indexOf('ph-currency-inr');
    const rowStart = html.lastIndexOf('<div', start);
    const rowEnd = html.indexOf('ph-clock', start);
    assert.ok(start > -1 && rowStart > -1 && rowEnd > -1, 'the stipend / duration row is rendered');
    return html.slice(rowStart, html.indexOf('</div>', rowEnd));
}

test('stipend and duration sit side by side without a stray bullet', () => {
    const row = renderCard({ monthlyStipend: 5000, duration: '12 Months' });
    assert.match(row, /₹5,000 \/ month/);
    assert.match(row, /12 Months/);
    assert.doesNotMatch(row, /&bull;|•/);
});

test('spacing comes from the flex gap and the row can wrap on narrow cards', () => {
    const row = renderCard({ monthlyStipend: 15000, duration: '6 Months' });
    const classes = (row.match(/^<div class="([^"]*)"/) || [])[1] || '';
    assert.match(classes, /\bgap-x-3\b/);
    assert.match(classes, /\bflex-wrap\b/);
});

test('the fallback stipend and duration render the same way', () => {
    const row = renderCard({ monthlyStipend: undefined, duration: undefined });
    assert.match(row, /₹5,000 \/ month/);
    assert.match(row, /12 Months/);
    assert.doesNotMatch(row, /&bull;|•/);
});
