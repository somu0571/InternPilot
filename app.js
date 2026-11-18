require("dotenv").config();


if (!process.env.GEMINI_MODEL || process.env.GEMINI_MODEL.includes('3.8') || process.env.GEMINI_MODEL.includes('3.5')) {
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
}
if (!process.env.GEMINI_FALLBACK_MODEL || process.env.GEMINI_FALLBACK_MODEL.includes('3.8') || process.env.GEMINI_FALLBACK_MODEL.includes('3.5')) {
    process.env.GEMINI_FALLBACK_MODEL = 'gemini-2.0-flash';
}

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    
    
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception thrown:', error);
    process.exit(1);
});

const express = require("express");
const ejsMate = require("ejs-mate");
const methodOverride = require("method-override");
const mongoose = require("mongoose");
const path = require("path");
const session = require("express-session");
const flash = require("connect-flash");
const passport = require("passport");
const { requireTransactionSupport } = require('./utils/database');

require("./config/passport");

const User = require("./models/User");
const Internship = require("./models/Internship");
const Notification = require('./models/Notification');
const { buildNavigationState } = require('./utils/navigation');
const { checkPmisEligibility } = require('./utils/pmisEligibility');
const { calculateProfileCompletion } = require('./utils/profileCompletion');
const { sanitizeHttpUrl } = require('./utils/safeUrl');

const authRoutes = require("./routes/auth");
const internshipRoutes = require("./routes/internships");
const userRoutes = require("./routes/user");
const candidateRoutes = require('./routes/candidate');
const companyRoutes = require('./routes/company');
const adminRoutes = require('./routes/admin');
const chatRoutes = require('./routes/chat');
const notificationRoutes = require('./routes/notifications');
const activityRoutes = require('./routes/activity');
const pagesRoutes = require('./routes/pages');
const analyticsRoutes = require('./routes/analytics');

const app = express();
const port = process.env.PORT || 8080;


app.locals.sanitizeHttpUrl = sanitizeHttpUrl;


app.engine("ejs", ejsMate);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));


app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use((req, res, next) => {
    if (typeof req.xhr === 'undefined') {
        Object.defineProperty(req, 'xhr', {
            get() {
                const val = this.get('X-Requested-With') || '';
                return val.toLowerCase() === 'xmlhttprequest';
            },
            configurable: true
        });
    }
    next();
});
app.use(methodOverride("_method"));
app.use(express.static(path.join(__dirname, "public"), {
    maxAge: '1h',
    etag: true,
    lastModified: true
}));



if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(session(require('./utils/sessionStore').buildSessionOptions()));


app.use(passport.initialize());
app.use(passport.session());
app.use(flash());


app.use(async (req, res, next) => {
    res.locals.currentUser = req.user;
    res.locals.currentPath = req.path;
    res.locals.navigation = buildNavigationState(req.path);
    res.locals.success_msg = req.flash("success_msg");
    res.locals.error_msg = req.flash("error_msg");
    res.locals.error = req.flash("error");
    res.locals.notificationUnreadCount = 0;
    res.locals.checkPmisEligibility = checkPmisEligibility;
    res.locals.calculateProfileCompletion = calculateProfileCompletion;

    
    
    const needsNotifications = req.user && req.accepts('html');

    if (needsNotifications) {
        try {
            const role = req.user.role;
            if (role === 'candidate') {
                res.locals.notificationUnreadCount = await Notification.countDocuments({
                    recipient: req.user._id,
                    isRead: false
                });
            } else if (role === 'company' || role === 'recruiter') {
                const targetCompanyId = role === 'company' ? req.user._id : req.user.companyId;
                res.locals.notificationUnreadCount = await Notification.countDocuments({
                    companyId: targetCompanyId,
                    isRead: false
                });
            }
        } catch (error) {
            
            
            console.error('Error loading notification count:', error);
        }
    }

    return next();
});

async function main() {
    await mongoose.connect(process.env.ATLASDB_URL);
    await requireTransactionSupport(mongoose.connection);
}



app.use(require('./middleware/trackSession'));
app.use(require('./routes/accountSessions'));



app.use(require('./routes/messages'));



app.use(require('./routes/adminConsole'));


app.use(require('./routes/resumeParse'));


app.use(require('./routes/grievances'));


app.get('/', async (req, res) => {
    try {
        let [totalInternships, totalCandidates, totalCompanies] = await Promise.all([
            Internship.countDocuments({ status: { $ne: 'draft' } }),
            User.countDocuments({ role: 'candidate' }),
            User.countDocuments({ role: 'company' })
        ]);

        if (totalInternships === 0) {
            totalInternships = await Internship.countDocuments({});
        }

        res.render('extras/index', { totalInternships, totalCandidates, totalCompanies });
    } catch (error) {
        console.error("Error rendering homepage:", error);
        res.render('extras/index', { totalInternships: 0, totalCandidates: 0, totalCompanies: 0 });
    }
});


app.use('/', pagesRoutes);
app.use('/auth', authRoutes);
app.use('/internships', internshipRoutes);
app.use('/', userRoutes);
app.use('/', candidateRoutes);
app.use('/', require('./routes/candidateVerification'));
app.use('/', companyRoutes);
app.use('/', require('./routes/offers'));
app.use('/admin', adminRoutes);
app.use('/', chatRoutes);
app.use('/', notificationRoutes);
app.use('/', activityRoutes);
app.use('/', require('./routes/interview'));
app.use('/', require('./routes/problems'));
app.use('/', require('./routes/certificates'));
app.use('/', require('./routes/reviews'));
app.use('/api', activityRoutes);
app.use('/api/v1', analyticsRoutes);


app.get('/favicon.ico', (req, res) => res.status(204).end());


app.use((req, res, next) => {
    const err = new Error(`Page Not Found: ${req.originalUrl}`);
    err.status = 404;
    next(err);
});


app.use((err, req, res, next) => {
    console.error('Express Error:', err.stack || err);
    if (res.headersSent) {
        return next(err);
    }

    const statusCode = err.status || 500;
    const errorMessage = err.message || 'Internal Server Error';

    res.status(statusCode).render('extras/error', {
        message: errorMessage,
        error: process.env.NODE_ENV === 'development' ? err : {}
    }, (renderErr, html) => {
        if (renderErr) {
            const safeMessage = String(errorMessage)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
            return res.status(statusCode).send(`
                <div style="font-family: sans-serif; padding: 2rem; max-width: 600px; margin: auto;">
                    <h2>Something went wrong (${statusCode})</h2>
                    <p><strong>Error:</strong> ${safeMessage}</p>
                    <a href="/">Return to Home</a>
                </div>
            `);
        }
        res.send(html);
    });
});

async function startServer() {
    try {
        await main();
        console.log("MongoDB Connected Successfully");

        
        
        require('./utils/scheduler');
        app.listen(port, () => {
            console.log(`Server running on port ${port}`);
        });
    } catch (err) {
        console.error('Database startup failed:', err);
        await mongoose.disconnect().catch(() => { });
        process.exitCode = 1;
    }
}

startServer();
