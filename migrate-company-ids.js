require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Internship = require('./models/Internship');

async function runMigration() {
    try {
        console.log('Connecting to DB...');
        await mongoose.connect(process.env.ATLASDB_URL);
        console.log('Connected.');

        
        console.log('\n--- Migrating Users ---');
        const companyUsers = await User.find({ role: 'company' });
        let updatedUsers = 0;
        for (const user of companyUsers) {
            let changed = false;
            if (!user.companyId) {
                user.companyId = user._id;
                changed = true;
            }
            if (user.isActive === undefined || user.isActive === null) {
                user.isActive = true;
                changed = true;
            }
            if (changed) {
                await user.save();
                updatedUsers++;
            }
        }
        console.log(`Updated ${updatedUsers} company users.`);

        
        console.log('\n--- Migrating Internships ---');
        const internships = await Internship.find({ companyId: { $exists: false } });
        let migratedInternships = 0;
        let flaggedInternships = 0;

        for (const internship of internships) {
            let assignedCompanyId = null;

            if (internship.postedBy) {
                const user = await User.findById(internship.postedBy);
                if (user && user.companyId) {
                    assignedCompanyId = user.companyId;
                }
            }

            
            if (!assignedCompanyId && internship.companyName) {
                const matchedUsers = await User.find({
                    'companyDetails.companyName': internship.companyName,
                    role: 'company'
                });

                if (matchedUsers.length === 1) {
                    assignedCompanyId = matchedUsers[0]._id;
                } else if (matchedUsers.length === 0) {
                    console.log(`[FLAG] Internship ${internship._id} ("${internship.title}") has 0 matches for companyName "${internship.companyName}".`);
                } else {
                    console.log(`[FLAG] Internship ${internship._id} ("${internship.title}") has multiple matches for companyName "${internship.companyName}".`);
                }
            }

            if (assignedCompanyId) {
                internship.companyId = assignedCompanyId;
                await internship.save();
                migratedInternships++;
            } else {
                flaggedInternships++;
            }
        }
        console.log(`Migrated ${migratedInternships} internships.`);
        if (flaggedInternships > 0) {
            console.log(`[WARNING] ${flaggedInternships} internships could not be automatically migrated and require manual review.`);
        }

    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        mongoose.disconnect();
        console.log('Done.');
    }
}

runMigration();
