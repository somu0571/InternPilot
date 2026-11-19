// routes/recommendations.js
// Handles recommendation detail view for a candidate.
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { isAuthenticated, authorize } = require('../middleware/auth');
const Recommendation = require('../models/Recommendation');

// GET /recommendations/:id – show a single recommendation belonging to the logged‑in candidate
router.get(
  '/:id',
  isAuthenticated,
  authorize('candidate'),
  async (req, res) => {
    try {
      const { id } = req.params;

      // Validate ObjectId format
      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash('error_msg', 'Invalid recommendation ID.');
        return res.redirect('/candidate/applications');
      }

      // Find the recommendation for this candidate and populate the related internship
      const recommendation = await Recommendation.findOne({
        _id: id,
        candidate: req.user._id,
      }).populate('internship');

      if (!recommendation) {
        req.flash('error_msg', 'Recommendation not found.');
        return res.redirect('/candidate/applications');
      }

      // Render a simple view – you can replace with a richer template later
      res.render('recommendations/show', {
        recommendation,
        currentUser: req.user,
        pageTitle: 'Recommendation Details',
      });
    } catch (err) {
      console.error('Error fetching recommendation:', err);
      req.flash('error_msg', 'Server error while loading recommendation.');
      res.redirect('/candidate/applications');
    }
  }
);

module.exports = router;
