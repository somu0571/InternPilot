const express = require('express');
const router = express.Router();




router.get(['/about', '/about-us'], (req, res) => {
    res.render('extras/about');
});


router.get(['/guidelines', '/scheme-guidelines'], (req, res) => {
    res.render('extras/guidelines');
});


router.get(['/contact', '/contact-us', '/help', '/support'], (req, res) => {
    res.render('extras/contact');
});


router.get(['/grievance', '/grievances'], (req, res) => {
    res.render('extras/grievance');
});


router.get(['/privacy', '/privacy-policy'], (req, res) => {
    res.render('extras/privacy');
});


router.get(['/terms', '/terms-and-conditions', '/terms-of-service', '/terms-of-use'], (req, res) => {
    res.render('extras/terms');
});


router.get(['/hyperlinking', '/hyperlinking-policy', '/hyperlink-policy'], (req, res) => {
    res.render('extras/hyperlinking');
});


router.get('/directory', (req, res) => {
    res.redirect('/internships');
});

module.exports = router;
