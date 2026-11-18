const express = require('express');
const router = express.Router();
const { loadResumeParse } = require('../utils/resumeParse');



router.get('/candidate/profile', loadResumeParse);

module.exports = router;
