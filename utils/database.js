function supportsTransactions(hello = {}) {
    return Boolean(hello.setName || hello.msg === 'isdbgrid');
}

async function requireTransactionSupport(connection) {
    const hello = await connection.db.admin().command({ hello: 1 });
    if (!supportsTransactions(hello)) {
        throw new Error(
            'InternPilot requires MongoDB transactions. Connect to MongoDB Atlas, a replica set, or a sharded cluster.'
        );
    }
}

module.exports = {
    supportsTransactions,
    requireTransactionSupport
};
