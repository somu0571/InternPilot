const test = require('node:test');
const assert = require('node:assert/strict');

const {
    DOCUMENT_TYPES,
    buildDocumentFileName,
    generateInternshipDocument
} = require('../utils/internshipDocuments');

test('builds stable PDF filenames for the two issued document types', () => {
    assert.deepEqual(DOCUMENT_TYPES, ['internship-certificate', 'recommendation-letter']);
    assert.equal(buildDocumentFileName('internship-certificate', 'Asha Rao'), 'Internship-Certificate-Asha-Rao.pdf');
    assert.equal(buildDocumentFileName('recommendation-letter', ''), 'Recommendation-Letter-candidate.pdf');
});

test('generates a PDF buffer for each issued document type', async () => {
    for (const type of DOCUMENT_TYPES) {
        const generated = await generateInternshipDocument({
            type,
            candidateName: 'Asha Rao',
            companyName: 'Example Labs',
            internshipTitle: 'Software Engineering',
            issuedAt: new Date('2026-09-27T00:00:00Z')
        });

        assert.equal(generated.contentType, 'application/pdf');
        assert.equal(generated.fileData.subarray(0, 5).toString(), '%PDF-');
        assert.equal(generated.fileData.subarray(-6).toString(), '%%EOF\n');
        assert.match(generated.fileName, /\.pdf$/);
    }
});

test('rejects unsupported internship document types', async () => {
    await assert.rejects(
        generateInternshipDocument({ type: 'offer-letter' }),
        /Unsupported internship document type/
    );
});