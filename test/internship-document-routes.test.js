const test = require('node:test');
const assert = require('node:assert/strict');

const Application = require('../models/Application');
const InternshipDocument = require('../models/InternshipDocument');
const companyRouter = require('../routes/company');
const candidateRouter = require('../routes/candidate');

const applicationId = '6a68f3c52d2ac7251bcc12d8';
const candidateId = '6a68f3c52d2ac7251bcc12d9';
const internshipId = '6a68f3c52d2ac7251bcc12da';
const companyId = '6a68f3c52d2ac7251bcc12db';
const issuerId = '6a68f3c52d2ac7251bcc12dc';

function routeHandler(router, method, path) {
    const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
    assert.ok(layer, `Expected ${method.toUpperCase()} ${path} route to be registered`);
    return layer.route.stack.at(-1).handle;
}

function responseMock() {
    return {
        statusCode: 200,
        headers: {},
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
        set(name, value) { this.headers[name] = value; return this; },
        end(value) { this.body = value; return this; },
        redirect(path) { this.redirectPath = path; return this; },
        send(value) { this.body = value; return this; }
    };
}

function createApplication(status = 'Hired', ownerId = companyId) {
    return {
        _id: applicationId,
        status,
        candidate: { _id: candidateId, name: 'Asha Rao' },
        internship: {
            _id: internshipId,
            title: 'Software Engineering',
            companyName: 'Example Labs',
            companyId: ownerId
        }
    };
}

function issueRequest(application) {
    return {
        params: { id: applicationId },
        user: { _id: issuerId },
        company: { _id: companyId, name: 'Example Labs', companyDetails: { companyName: 'Example Labs' } },
        headers: { accept: 'application/json' },
        is: () => false,
        flash() {}
    };
}

test('registers the requested issue endpoint and candidate PDF download endpoint', () => {
    routeHandler(companyRouter, 'post', '/company/applications/:id/certificates/issues');
    routeHandler(candidateRouter, 'get', '/candidate/applications/:id/certificates/:type');
});

test('issues and persists both PDFs only for a hired application owned by the company', async t => {
    const originalFindById = Application.findById;
    const originalFind = InternshipDocument.find;
    const originalInsertMany = InternshipDocument.insertMany;
    const savedDocuments = [];
    const application = createApplication();

    t.after(() => {
        Application.findById = originalFindById;
        InternshipDocument.find = originalFind;
        InternshipDocument.insertMany = originalInsertMany;
    });

    Application.findById = () => Object.assign(application, { populate() { return this; } });
    InternshipDocument.find = () => ({
        select() { return this; },
        lean() { return Promise.resolve(savedDocuments); },
        then(resolve, reject) {
            return Promise.resolve(savedDocuments.map(({ type }) => ({ type }))).then(resolve, reject);
        }
    });
    InternshipDocument.insertMany = async documents => {
        savedDocuments.push(...documents);
        return documents;
    };

    const response = responseMock();
    await routeHandler(companyRouter, 'post', '/company/applications/:id/certificates/issues')(
        issueRequest(application), response
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.success, true);
    assert.equal(savedDocuments.length, 2);
    assert.deepEqual(savedDocuments.map(document => document.type).sort(), [
        'internship-certificate',
        'recommendation-letter'
    ]);
    assert.ok(savedDocuments.every(document => document.fileData.subarray(0, 5).toString() === '%PDF-'));
    assert.equal(response.body.documents.length, 2);
});

test('refuses issuance before hire and for applications belonging to another company', async t => {
    const originalFindById = Application.findById;
    const originalFind = InternshipDocument.find;
    let documentLookupCount = 0;

    t.after(() => {
        Application.findById = originalFindById;
        InternshipDocument.find = originalFind;
    });

    let application = createApplication('Shortlisted');
    Application.findById = () => Object.assign(application, { populate() { return this; } });
    InternshipDocument.find = () => {
        documentLookupCount += 1;
        return { select() { return Promise.resolve([]); } };
    };

    let response = responseMock();
    await routeHandler(companyRouter, 'post', '/company/applications/:id/certificates/issues')(
        issueRequest(application), response
    );
    assert.equal(response.statusCode, 409);

    application = createApplication('Hired', '6a68f3c52d2ac7251bcc12dd');
    response = responseMock();
    await routeHandler(companyRouter, 'post', '/company/applications/:id/certificates/issues')(
        issueRequest(application), response
    );
    assert.equal(response.statusCode, 404);
    assert.equal(documentLookupCount, 0);
});

test('candidate downloads are looked up using both application and candidate ownership', async t => {
    const originalFindOne = InternshipDocument.findOne;
    let lookup;
    const pdf = Buffer.from('%PDF-test');

    t.after(() => {
        InternshipDocument.findOne = originalFindOne;
    });

    InternshipDocument.findOne = async query => {
        lookup = query;
        return { contentType: 'application/pdf', fileName: 'Internship-Certificate-Asha-Rao.pdf', fileData: pdf };
    };

    const response = responseMock();
    await routeHandler(candidateRouter, 'get', '/candidate/applications/:id/certificates/:type')({
        params: { id: applicationId, type: 'internship-certificate' },
        user: { _id: candidateId }
    }, response);

    assert.deepEqual(lookup, {
        application: applicationId,
        candidate: candidateId,
        type: 'internship-certificate'
    });
    assert.equal(response.headers['Content-Type'], 'application/pdf');
    assert.equal(response.body, pdf);
});
