const PDFDocument = require('pdfkit');
const InternshipDocument = require('../models/InternshipDocument');

const DOCUMENT_TYPES = ['internship-certificate', 'recommendation-letter'];

function safeDocumentName(value) {
    return String(value || 'candidate')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'candidate';
}

function buildDocumentFileName(type, candidateName) {
    const prefix = type === 'internship-certificate'
        ? 'Internship-Certificate'
        : 'Recommendation-Letter';
    return `${prefix}-${safeDocumentName(candidateName)}.pdf`;
}

function formatIssueDate(value) {
    return new Intl.DateTimeFormat('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Asia/Kolkata'
    }).format(value);
}

async function generateInternshipDocument({ type, candidateName, companyName, internshipTitle, issuedAt }) {
    if (!DOCUMENT_TYPES.includes(type)) throw new Error('Unsupported internship document type.');

    const values = {
        candidateName: String(candidateName || 'Candidate'),
        companyName: String(companyName || 'Company'),
        internshipTitle: String(internshipTitle || 'Internship'),
        issuedAt: issuedAt instanceof Date ? issuedAt : new Date(issuedAt || Date.now())
    };

    return new Promise((resolve, reject) => {
        const pdf = new PDFDocument({ size: 'A4', margin: 64 });
        const chunks = [];
        pdf.on('data', chunk => chunks.push(chunk));
        pdf.on('error', reject);
        pdf.on('end', () => resolve({
            fileName: buildDocumentFileName(type, values.candidateName),
            contentType: 'application/pdf',
            fileData: Buffer.concat(chunks)
        }));

        const issueDate = formatIssueDate(values.issuedAt);
        if (type === 'internship-certificate') {
            pdf.font('Helvetica-Bold').fontSize(22).text('INTERNSHIP CERTIFICATE', { align: 'center' });
            pdf.moveDown(2);
            pdf.font('Helvetica').fontSize(12).text('This certifies that', { align: 'center' });
            pdf.moveDown(0.5);
            pdf.font('Helvetica-Bold').fontSize(20).text(values.candidateName, { align: 'center' });
            pdf.moveDown();
            pdf.font('Helvetica').fontSize(12).text(
                `has been selected for the ${values.internshipTitle} internship with ${values.companyName}.`,
                { align: 'center', lineGap: 5 }
            );
            pdf.moveDown(2);
            pdf.fontSize(11).text(`Issued on ${issueDate}`, { align: 'center' });
        } else {
            pdf.font('Helvetica-Bold').fontSize(20).text('LETTER OF RECOMMENDATION', { align: 'center' });
            pdf.moveDown(2);
            pdf.font('Helvetica').fontSize(12).text('To Whom It May Concern,');
            pdf.moveDown();
            pdf.text(
                `I am pleased to recommend ${values.candidateName} for future opportunities. ${values.candidateName} was selected for the ${values.internshipTitle} internship with ${values.companyName}. This letter confirms the placement recorded by our organization.`,
                { align: 'left', lineGap: 5 }
            );
            pdf.moveDown();
            pdf.text(`Issued on ${issueDate}.`);
        }

        pdf.moveDown(4);
        pdf.font('Helvetica-Bold').fontSize(12).text(values.companyName);
        pdf.font('Helvetica').fontSize(10).text('Authorized Company Representative');
        pdf.end();
    });
}

async function getIssuedDocumentsByApplication(applications, candidateId) {
    const hiredApplicationIds = (Array.isArray(applications) ? applications : [])
        .filter(application => application.status === 'Hired')
        .map(application => application._id);
    if (!hiredApplicationIds.length) return {};

    const documents = await InternshipDocument.find({
        candidate: candidateId,
        application: { $in: hiredApplicationIds }
    }).select('application type').lean();

    return documents.reduce((byApplication, document) => {
        const applicationId = String(document.application);
        if (!byApplication[applicationId]) byApplication[applicationId] = [];
        byApplication[applicationId].push(document.type);
        return byApplication;
    }, {});
}

module.exports = {
    DOCUMENT_TYPES,
    buildDocumentFileName,
    generateInternshipDocument,
    getIssuedDocumentsByApplication
};