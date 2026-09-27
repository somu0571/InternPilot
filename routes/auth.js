const express = require('express');
const router = express.Router();
const passport = require('passport');
const crypto = require('crypto');
const User = require('../models/User');
const { sendOTPEmail } = require('../utils/sendEmail');

const generateSecureOTP = () => {
    return crypto.randomInt(100000, 1000000).toString();
};

const redirectIfAuthenticated = (req, res, next) => {
    if (req.isAuthenticated && req.isAuthenticated()) {
        if (req.user.role === 'admin') return res.redirect('/admin/dashboard');
        if (['company', 'recruiter', 'hiring_manager'].includes(req.user.role)) return res.redirect('/company/dashboard');
        return res.redirect('/');
    }
    next();
};

router.get('/login', redirectIfAuthenticated, (req, res) => res.render('auth/login'));
router.get('/register', redirectIfAuthenticated, (req, res) => res.render('auth/register'));

router.post('/register', async (req, res) => {
    const { name, email, password, role, adminSecretKey, companyName, cin, industry } = req.body;
    const normalizedEmail = (email || '').trim().toLowerCase();
    const trimmedName = (name || '').trim();

    console.log('\n--- New Registration Request ---');
    console.log('Received Payload Email:', normalizedEmail);

    try {
        if (!trimmedName) {
            req.flash('error_msg', 'Full name is required.');
            return res.redirect('/auth/register');
        }

        if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
            console.error('ERROR: Email field is empty or invalid format in req.body!');
            req.flash('error_msg', 'A valid email address is required.');
            return res.redirect('/auth/register');
        }

        if (!password || typeof password !== 'string' || password.length < 6) {
            req.flash('error_msg', 'Password must be at least 6 characters long.');
            return res.redirect('/auth/register');
        }

        let selectedRole = 'candidate';

        if (role === 'admin') {
            const SYSTEM_ADMIN_SECRET = process.env.ADMIN_SECRET || process.env.ADMIN_CODE;

            if (!SYSTEM_ADMIN_SECRET) {
                req.flash('error_msg', 'Admin registration is not configured on this server.');
                return res.redirect('/auth/register');
            }

            if (!adminSecretKey || adminSecretKey !== SYSTEM_ADMIN_SECRET) {
                req.flash('error_msg', 'Invalid Admin Security Key. Access denied.');
                return res.redirect('/auth/register');
            }
            selectedRole = 'admin';
        } else if (role === 'company') {
            if (!companyName || !companyName.trim()) {
                req.flash('error_msg', 'Company name is required for company registration.');
                return res.redirect('/auth/register');
            }
            selectedRole = 'company';
        }

        const existing = await User.findOne({ email: normalizedEmail });

        // If user already exists in DB
        if (existing) {
            if (existing.isEmailVerified) {
                console.log('Status: User exists and is already verified.');
                req.flash('error_msg', 'Email already registered. Please log in.');
                return res.redirect('/auth/register');
            } else {
                console.log('Status: User exists but is unverified. Checking cooldown...');
                const COOLDOWN_SECONDS = 60;
                const now = Date.now();

                if (existing.lastOtpSentAt) {
                    const elapsedSeconds = Math.floor((now - new Date(existing.lastOtpSentAt).getTime()) / 1000);
                    if (elapsedSeconds < COOLDOWN_SECONDS) {
                        const remainingSeconds = COOLDOWN_SECONDS - elapsedSeconds;
                        req.flash('error_msg', `Please wait ${remainingSeconds}s before requesting a new code.`);
                        return res.redirect(`/auth/verify-otp?email=${encodeURIComponent(normalizedEmail)}`);
                    }
                }

                const otp = generateSecureOTP();
                existing.name = trimmedName;
                existing.role = selectedRole;
                existing.password = password;
                existing.otp = otp;
                existing.otpExpires = new Date(now + 10 * 60 * 1000);
                existing.lastOtpSentAt = new Date(now);

                if (selectedRole === 'company') {
                    existing.companyDetails = {
                        companyName: companyName.trim(),
                        cin: cin || '',
                        industry: industry || '',
                        isVerified: false,
                        verificationStatus: 'pending',
                        verificationSubmittedAt: new Date(),
                        verificationHistory: [{
                            status: 'pending',
                            reason: 'Company account registered.',
                            changedAt: new Date()
                        }]
                    };
                    existing.companyId = existing._id;
                }

                await existing.save();

                try {
                    await sendOTPEmail(normalizedEmail, otp);
                    console.log(`--> Fresh verification code successfully sent to: ${normalizedEmail}`);
                    req.flash('success_msg', 'A new verification code has been sent to your email.');
                } catch (emailErr) {
                    console.error('--> Failed to send updated OTP email:', emailErr.message);
                    req.flash('error_msg', "Account updated, but we couldn't send the code. Please click Resend OTP.");
                }

                return res.redirect(`/auth/verify-otp?email=${encodeURIComponent(normalizedEmail)}`);
            }
        }

        const otp = generateSecureOTP();
        const otpExpires = new Date(Date.now() + 10 * 60 * 1000);
        const lastOtpSentAt = new Date();

        const userData = {
            name: trimmedName,
            email: normalizedEmail,
            password,
            role: selectedRole,
            isEmailVerified: false,
            otp,
            otpExpires,
            lastOtpSentAt
        };

        if (userData.role === 'company') {
            userData.companyDetails = {
                companyName: companyName.trim(),
                cin: cin || '',
                industry: industry || '',
                isVerified: false,
                verificationStatus: 'pending',
                verificationSubmittedAt: new Date(),
                verificationHistory: [{
                    status: 'pending',
                    reason: 'Company account registered.',
                    changedAt: new Date()
                }]
            };
        }

        // Create pending user record before dispatching email to guarantee persistence
        const newUser = await User.create(userData);

        // Company owners need companyId set to their own _id
        // so requireCompanyRole middleware allows access
        if (newUser.role === 'company') {
            newUser.companyId = newUser._id;
            await newUser.save();
        }

        console.log('--> User account created in MongoDB.');
        console.log(`--> Dispatching verification code via Nodemailer to ${normalizedEmail}...`);

        try {
            await sendOTPEmail(normalizedEmail, otp);
            console.log('--> Email sent successfully!');
            req.flash('success_msg', 'Verification code sent to your email!');
        } catch (emailErr) {
            console.error('--> Failed to send initial OTP email:', emailErr.message);
            req.flash('error_msg', "Account created, but we couldn't send the code. Please click Resend OTP.");
        }

        res.redirect(`/auth/verify-otp?email=${encodeURIComponent(normalizedEmail)}`);
    } catch (err) {
        console.error('--> REGISTRATION / EMAIL ERROR:', err);
        req.flash('error_msg', "We couldn't complete registration. Please try again in a moment.");
        res.redirect('/auth/register');
    }
});

router.get('/verify-otp', (req, res) => {
    const email = (req.query.email || '').trim().toLowerCase();
    res.render('extras/verify-otp', { email });
});

router.post('/verify-otp', async (req, res) => {
    const email = (req.body.email || '').trim().toLowerCase();
    const otp = (req.body.otp || '').trim();

    try {
        if (!email || !otp) {
            req.flash('error_msg', 'Email and verification code are required.');
            return res.redirect(`/auth/verify-otp?email=${encodeURIComponent(email)}`);
        }

        console.log(`Verifying OTP for ${email}...`);
        const user = await User.findOne({ email });

        if (!user) {
            req.flash('error_msg', 'No account found for this email address. Please register.');
            return res.redirect('/auth/register');
        }

        if (user.isEmailVerified) {
            req.flash('success_msg', 'Account is already verified. Please log in.');
            return res.redirect('/auth/login');
        }

        const isExpired = !user.otpExpires || new Date(user.otpExpires).getTime() < Date.now();
        if (!user.otp || user.otp !== otp || isExpired) {
            req.flash('error_msg', 'Invalid or expired OTP code.');
            return res.redirect(`/auth/verify-otp?email=${encodeURIComponent(email)}`);
        }

        user.isEmailVerified = true;
        user.otp = undefined;
        user.otpExpires = undefined;
        user.lastOtpSentAt = undefined;
        await user.save();

        console.log(`User ${email} verified successfully.`);
        req.flash('success_msg', 'Account verified successfully! You can now log in.');
        res.redirect('/auth/login');
    } catch (err) {
        console.error('Verification error:', err);
        req.flash('error_msg', 'Something went wrong during verification.');
        res.redirect('/auth/login');
    }
});

router.post('/resend-otp', async (req, res) => {
    const email = (req.body.email || '').trim().toLowerCase();

    try {
        if (!email) {
            req.flash('error_msg', 'Email address is required to resend OTP.');
            return res.redirect('/auth/register');
        }

        const COOLDOWN_SECONDS = 60;
        const now = Date.now();
        const otp = generateSecureOTP();
        const otpExpires = now + 10 * 60 * 1000;
        const cooldownThreshold = new Date(now - COOLDOWN_SECONDS * 1000);

        // Atomically reserve the resend cooldown to prevent concurrent request race conditions
        const updatedUser = await User.findOneAndUpdate(
            {
                email,
                isEmailVerified: false,
                $or: [
                    { lastOtpSentAt: { $exists: false } },
                    { lastOtpSentAt: null },
                    { lastOtpSentAt: { $lte: cooldownThreshold } }
                ]
            },
            {
                $set: {
                    otp,
                    otpExpires,
                    lastOtpSentAt: now
                }
            },
            { new: true }
        );

        if (!updatedUser) {
            const user = await User.findOne({ email });

            if (!user) {
                req.flash('error_msg', 'User not found. Please register first.');
                return res.redirect('/auth/register');
            }

            if (user.isEmailVerified) {
                req.flash('error_msg', 'Account is already verified. Please log in.');
                return res.redirect('/auth/login');
            }

            const elapsedSeconds = Math.floor((now - new Date(user.lastOtpSentAt).getTime()) / 1000);
            const remainingSeconds = Math.max(1, COOLDOWN_SECONDS - elapsedSeconds);
            req.flash('error_msg', `Please wait ${remainingSeconds}s before requesting a new code.`);
            return res.redirect(`/auth/verify-otp?email=${encodeURIComponent(email)}`);
        }

        await sendOTPEmail(email, otp);

        req.flash('success_msg', 'A new verification code has been sent to your email.');
        res.redirect(`/auth/verify-otp?email=${encodeURIComponent(email)}`);
    } catch (err) {
        console.error('Resend OTP error:', err);
        req.flash('error_msg', "We couldn't send your code. Please try again in a moment.");
        res.redirect(`/auth/verify-otp?email=${encodeURIComponent(email)}`);
    }
});

router.post('/login', (req, res, next) => {
    passport.authenticate('local', async (err, user, info) => {
        if (err) return next(err);
        if (!user) {
            req.flash('error_msg', info ? info.message : 'Invalid email or password.');
            return res.redirect('/auth/login');
        }

        if (!user.isEmailVerified) {
            req.flash('error_msg', 'Please verify your email via OTP before logging in.');
            return res.redirect(`/auth/verify-otp?email=${encodeURIComponent(user.email)}`);
        }

        req.logIn(user, (err) => {
            if (err) return next(err);

            // Handle "Remember Me"
            if (req.body.remember) {
                req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
            }

            req.flash('success_msg', `Welcome back, ${user.name}!`);

            if (user.role === 'admin') {
                return res.redirect('/admin/dashboard');
            } else if (['company', 'recruiter', 'hiring_manager'].includes(user.role)) {
                return res.redirect('/company/dashboard');
            } else {
                return res.redirect('/');
            }
        });
    })(req, res, next);
});

router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/google/callback', (req, res, next) => {
    passport.authenticate('google', (err, user) => {
        if (err || !user) {
            req.flash('error_msg', 'Google authentication failed or account deactivated.');
            return res.redirect('/auth/login');
        }

        if (!user.isEmailVerified) {
            user.isEmailVerified = true;
            user.save().catch(console.error);
        }

        req.logIn(user, (err) => {
            if (err) return next(err);
            req.flash('success_msg', `Welcome back, ${user.name}!`);

            if (user.role === 'admin') {
                return res.redirect('/admin/dashboard');
            } else if (['company', 'recruiter', 'hiring_manager'].includes(user.role)) {
                return res.redirect('/company/dashboard');
            } else {
                return res.redirect('/');
            }
        });
    })(req, res, next);
});

// Forgot & Reset Password Flow
router.get('/forgot-password', redirectIfAuthenticated, (req, res) => {
    res.render('auth/forgot-password');
});

router.post('/forgot-password', async (req, res) => {
    const email = (req.body.email || '').trim().toLowerCase();

    try {
        if (!email) {
            req.flash('error_msg', 'Email address is required.');
            return res.redirect('/auth/forgot-password');
        }

        const user = await User.findOne({ email });
        if (!user) {
            req.flash('error_msg', 'No account found with that email address.');
            return res.redirect('/auth/forgot-password');
        }

        const now = Date.now();
        const COOLDOWN_SECONDS = 60;
        if (user.lastOtpSentAt) {
            const elapsedSeconds = Math.floor((now - new Date(user.lastOtpSentAt).getTime()) / 1000);
            if (elapsedSeconds < COOLDOWN_SECONDS) {
                const remainingSeconds = COOLDOWN_SECONDS - elapsedSeconds;
                req.flash('error_msg', `Please wait ${remainingSeconds}s before requesting a new code.`);
                return res.redirect(`/auth/reset-password?email=${encodeURIComponent(email)}`);
            }
        }

        const otp = generateSecureOTP();
        user.otp = otp;
        user.otpExpires = new Date(now + 10 * 60 * 1000);
        user.lastOtpSentAt = new Date(now);
        await user.save();

        try {
            await sendOTPEmail(email, otp);
            req.flash('success_msg', 'Password reset code sent to your email.');
        } catch (emailErr) {
            console.error('Failed to send reset OTP email:', emailErr);
            req.flash('error_msg', 'Could not send verification code. Please check your email configuration.');
        }

        res.redirect(`/auth/reset-password?email=${encodeURIComponent(email)}`);
    } catch (err) {
        console.error('Forgot password error:', err);
        req.flash('error_msg', 'Something went wrong. Please try again.');
        res.redirect('/auth/forgot-password');
    }
});

router.get('/reset-password', redirectIfAuthenticated, (req, res) => {
    const email = (req.query.email || '').trim().toLowerCase();
    res.render('auth/reset-password', { email });
});

router.post('/reset-password', async (req, res) => {
    const email = (req.body.email || '').trim().toLowerCase();
    const otp = (req.body.otp || '').trim();
    const newPassword = req.body.password;
    const confirmPassword = req.body.confirmPassword;

    try {
        if (!email || !otp || !newPassword) {
            req.flash('error_msg', 'All fields are required.');
            return res.redirect(`/auth/reset-password?email=${encodeURIComponent(email)}`);
        }

        if (newPassword !== confirmPassword) {
            req.flash('error_msg', 'Passwords do not match.');
            return res.redirect(`/auth/reset-password?email=${encodeURIComponent(email)}`);
        }

        if (newPassword.length < 6) {
            req.flash('error_msg', 'Password must be at least 6 characters long.');
            return res.redirect(`/auth/reset-password?email=${encodeURIComponent(email)}`);
        }

        const user = await User.findOne({ email });
        if (!user || user.otp !== otp || !user.otpExpires || new Date(user.otpExpires).getTime() < Date.now()) {
            req.flash('error_msg', 'Invalid or expired OTP code.');
            return res.redirect(`/auth/reset-password?email=${encodeURIComponent(email)}`);
        }

        user.password = newPassword;
        user.isEmailVerified = true;
        user.otp = undefined;
        user.otpExpires = undefined;
        user.lastOtpSentAt = undefined;
        await user.save();

        req.flash('success_msg', 'Password reset successfully! You can now log in.');
        res.redirect('/auth/login');
    } catch (err) {
        console.error('Reset password error:', err);
        req.flash('error_msg', 'An error occurred while resetting your password.');
        res.redirect(`/auth/reset-password?email=${encodeURIComponent(email)}`);
    }
});

router.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        req.flash('success_msg', 'Logged out successfully.');
        if (req.session && typeof req.session.save === 'function') {
            req.session.save(() => {
                res.redirect('/auth/login');
            });
        } else {
            res.redirect('/auth/login');
        }
    });
});

module.exports = router;
