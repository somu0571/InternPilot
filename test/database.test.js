const test = require('node:test');
const assert = require('node:assert/strict');

const { supportsTransactions, requireTransactionSupport } = require('../utils/database');

test('transaction support is limited to replica sets and sharded clusters', () => {
    assert.equal(supportsTransactions({ setName: 'rs0' }), true);
    assert.equal(supportsTransactions({ msg: 'isdbgrid' }), true);
    assert.equal(supportsTransactions({}), false);
});

test('standalone MongoDB is rejected before serving requests', async () => {
    const standaloneConnection = {
        db: { admin: () => ({ command: async () => ({}) }) }
    };

    await assert.rejects(
        requireTransactionSupport(standaloneConnection),
        /requires MongoDB transactions/
    );
});
