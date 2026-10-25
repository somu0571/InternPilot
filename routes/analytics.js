const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Internship = require('../models/Internship');

// In-memory cache for landing stats (30 seconds TTL)
let cachedStats = null;
let lastCacheTime = 0;
const CACHE_TTL = 30 * 1000;

router.get('/analytics/landing-stats', async (req, res) => {
    try {
        const now = Date.now();
        if (cachedStats && (now - lastCacheTime < CACHE_TTL)) {
            return res.json(cachedStats);
        }

        let [candidates, companies, internships] = await Promise.all([
            User.countDocuments({ role: 'candidate' }),
            User.countDocuments({ role: 'company' }),
            Internship.countDocuments({ status: { $ne: 'draft' } })
        ]);

        // If no non-draft internships found, count all registered internships in the database
        if (internships === 0) {
            internships = await Internship.countDocuments({});
        }

        cachedStats = {
            candidates,
            companies,
            internships
        };
        lastCacheTime = now;

        return res.json(cachedStats);
    } catch (error) {
        console.error('Error fetching landing stats:', error);
        return res.status(500).json({
            error: 'Failed to fetch landing statistics',
            candidates: 0,
            companies: 0,
            internships: 0
        });
    }
});

module.exports = router;
