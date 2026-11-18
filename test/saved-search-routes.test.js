const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const candidateRouter = require('../routes/candidate');
const SavedSearch = require('../models/SavedSearch');

function routeLayer(path, method) {
    return candidateRouter.stack.find(layer =>
        layer.route && layer.route.path === path && layer.route.methods[method]
    );
}

function routeHandler(path, method) {
    const layer = routeLayer(path, method);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createResponse() {
    return {
        redirects: [],
        redirect(path) {
            this.redirects.push(path);
            return path;
        }
    };
}

function duplicateKeyError() {
    const error = new Error('E11000 duplicate key error');
    error.code = 11000;
    error.keyPattern = { candidate: 1, criteriaHash: 1 };
    return error;
}

test('saved-search routes expose the full candidate-owned CRUD flow', () => {
    const expected = [
        ['get', '/candidate/saved-searches'],
        ['post', '/candidate/saved-searches'],
        ['patch', '/candidate/saved-searches/:id'],
        ['post', '/candidate/saved-searches/:id/pause'],
        ['delete', '/candidate/saved-searches/:id'],
        ['get', '/candidate/saved-searches/:id/edit'],
        ['get', '/candidate/saved-searches/:id/results']
    ];

    expected.forEach(([method, path]) => {
        const layer = routeLayer(path, method);
        assert.ok(layer, `${method.toUpperCase()} ${path} is registered`);
        
        
        assert.ok(layer.route.stack.length >= 3, `${path} includes auth middleware and a handler`);
        assert.equal(layer.route.stack[0].handle.name, 'isAuthenticated');
    });
});

test('concurrent POST duplicate updates the saved search instead of exposing E11000', async t => {
    const originalFindOne = SavedSearch.findOne;
    const originalCountDocuments = SavedSearch.countDocuments;
    const originalCreate = SavedSearch.create;
    const originalConsoleError = console.error;
    t.after(() => {
        SavedSearch.findOne = originalFindOne;
        SavedSearch.countDocuments = originalCountDocuments;
        SavedSearch.create = originalCreate;
        console.error = originalConsoleError;
    });

    const concurrentSearch = {
        name: 'Previous name',
        frequency: 'off',
        delivery: { inApp: false, email: false },
        isPaused: true,
        async save() {
            this.saveCalls = (this.saveCalls || 0) + 1;
        }
    };
    let findOneCalls = 0;
    SavedSearch.findOne = async () => (++findOneCalls === 1 ? null : concurrentSearch);
    SavedSearch.countDocuments = async () => 0;
    SavedSearch.create = async () => {
        throw duplicateKeyError();
    };
    console.error = () => {};

    const flashes = [];
    const req = {
        user: { _id: new mongoose.Types.ObjectId() },
        body: {
            criteria: JSON.stringify({ search: 'JavaScript' }),
            name: 'JavaScript internships',
            frequency: 'daily',
            deliveryConfigured: 'true',
            inApp: 'on',
            returnTo: '/internships?search=JavaScript'
        },
        flash: (...args) => flashes.push(args)
    };
    const res = createResponse();

    await routeHandler('/candidate/saved-searches', 'post')(req, res);

    assert.equal(concurrentSearch.saveCalls, 1);
    assert.equal(concurrentSearch.name, 'JavaScript internships');
    assert.equal(concurrentSearch.frequency, 'daily');
    assert.deepEqual(concurrentSearch.delivery, { inApp: true, email: false });
    assert.equal(concurrentSearch.isPaused, false);
    assert.deepEqual(flashes, [['success_msg', 'Updated your existing saved search and alert preferences.']]);
    assert.deepEqual(res.redirects, ['/internships?search=JavaScript']);
});

test('concurrent PATCH duplicate shows a friendly duplicate-search message', async t => {
    const originalFindOne = SavedSearch.findOne;
    const originalExists = SavedSearch.exists;
    const originalConsoleError = console.error;
    t.after(() => {
        SavedSearch.findOne = originalFindOne;
        SavedSearch.exists = originalExists;
        console.error = originalConsoleError;
    });

    const savedSearch = {
        _id: new mongoose.Types.ObjectId(),
        criteria: { search: 'React' },
        criteriaHash: 'old-hash',
        name: 'React internships',
        frequency: 'instant',
        delivery: { inApp: true, email: false },
        async save() {
            throw duplicateKeyError();
        }
    };
    SavedSearch.findOne = async () => savedSearch;
    SavedSearch.exists = async () => null;
    console.error = () => {};

    const flashes = [];
    const req = {
        params: { id: savedSearch._id.toString() },
        user: { _id: new mongoose.Types.ObjectId() },
        body: {
            criteria: JSON.stringify({ search: 'JavaScript' }),
            name: 'JavaScript internships',
            frequency: 'instant',
            deliveryConfigured: 'true',
            inApp: 'on'
        },
        flash: (...args) => flashes.push(args)
    };
    const res = createResponse();

    await routeHandler('/candidate/saved-searches/:id', 'patch')(req, res);

    assert.deepEqual(flashes, [['error_msg', 'You already have a saved search with those filters.']]);
    assert.deepEqual(res.redirects, ['/candidate/saved-searches']);
});
