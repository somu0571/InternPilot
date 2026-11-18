require('dotenv').config();

const mongoose = require('mongoose');
const User = require('./models/User');
const Recommendation = require('./models/Recommendation');
const { buildSkillProfiles, skillNames } = require('./utils/skillProfiles');

function serializeProfiles(profiles) {
    return profiles.map(profile => ({
        name: profile.name,
        proficiency: profile.proficiency
    }));
}

function hasSameProfiles(left, right) {
    return JSON.stringify(serializeProfiles(left || [])) === JSON.stringify(serializeProfiles(right || []));
}


async function runMigration() {
    if (!process.env.ATLASDB_URL) {
        throw new Error('ATLASDB_URL is required to run the skill proficiency migration.');
    }

    await mongoose.connect(process.env.ATLASDB_URL);

    try {
        const candidates = await User.find({ role: 'candidate' })
            .select('_id skills skillProfiles')
            .lean();
        let updated = 0;

        for (const candidate of candidates) {
            const canonicalProfiles = buildSkillProfiles(candidate);
            const canonicalNames = skillNames(canonicalProfiles);
            const existingNames = Array.isArray(candidate.skills) ? candidate.skills : [];

            if (hasSameProfiles(candidate.skillProfiles, canonicalProfiles)
                && JSON.stringify(existingNames) === JSON.stringify(canonicalNames)) {
                continue;
            }

            
            
            
            
            await Recommendation.deleteMany({ candidate: candidate._id });
            await User.updateOne(
                { _id: candidate._id },
                { $set: { skillProfiles: canonicalProfiles, skills: canonicalNames } }
            );
            updated += 1;
        }

        console.log(`Skill proficiency migration complete: updated ${updated} candidate profile(s).`);
        return updated;
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) {
    runMigration().catch(error => {
        console.error('Skill proficiency migration failed:', error);
        process.exitCode = 1;
    });
}

module.exports = { runMigration, hasSameProfiles };
