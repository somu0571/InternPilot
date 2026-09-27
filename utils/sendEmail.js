require('dotenv').config();
const nodemailer = require('nodemailer');
const { sanitizeHttpUrl } = require('./safeUrl');

/**
 * Creates and returns a configured Nodemailer transporter.
 * Supports custom SMTP configuration with fallback to Gmail service.
 * Includes timeout settings to prevent hanging connections.
 */
const createTransporter = () => {
    const timeoutConfig = {
        connectionTimeout: 10000, // 10 seconds
        greetingTimeout: 10000,   // 10 seconds
        socketTimeout: 15000      // 15 seconds
    };

    if (process.env.SMTP_HOST) {
        const secure = process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465';

        return nodemailer.createTransport({
            ...timeoutConfig,
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT, 10) || 587,
            secure,
            requireTLS: !secure,
            auth: {
                user: process.env.SMTP_USER || process.env.EMAIL_USER,
                pass: process.env.SMTP_PASS || process.env.EMAIL_PASS
            }
        });
    }

    return nodemailer.createTransport({
        ...timeoutConfig,
        service: process.env.EMAIL_SERVICE || 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
};

/**
 * Sends an email with retry logic and exponential backoff.
 * Logs delivery attempts, successes, and failures server-side.
 * 
 * @param {Object} mailOptions 
 * @param {number} maxRetries 
 * @returns {Promise<Object>} info
 */
const sendWithRetry = async (mailOptions, maxRetries = 3) => {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`[EMAIL] [Attempt ${attempt}/${maxRetries}] Dispatching to: ${mailOptions.to} (Subject: "${mailOptions.subject}")`);
            const transporter = createTransporter();
            const info = await transporter.sendMail(mailOptions);
            console.log(`[EMAIL] SUCCESS: Email successfully delivered to ${mailOptions.to}. MessageId: ${info.messageId}`);
            return info;
        } catch (err) {
            lastError = err;
            console.error(`[EMAIL] ERROR: Attempt ${attempt}/${maxRetries} failed for ${mailOptions.to}: ${err.message}`);

            if (attempt < maxRetries) {
                const backoffDelay = attempt * 1500; // 1.5s, 3s backoff
                console.log(`[EMAIL] Retrying delivery in ${backoffDelay}ms...`);
                await new Promise((resolve) => setTimeout(resolve, backoffDelay));
            }
        }
    }

    console.error(`[EMAIL] CRITICAL: All ${maxRetries} delivery attempts failed for ${mailOptions.to}. Final Error: ${lastError?.message}`);
    throw lastError;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isValidEmail = (email) => {
    return typeof email === 'string' && EMAIL_REGEX.test(email);
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
}[character]));

const onlineMeetingDetails = (meetingLink) => {
    const safeMeetingLink = sanitizeHttpUrl(meetingLink).url;
    if (!safeMeetingLink) {
        return '<p><strong>Meeting Link:</strong> Please check InternPilot for the updated link.</p>';
    }

    const escapedMeetingLink = escapeHtml(safeMeetingLink);
    return `<p><strong>Meeting Link:</strong> <a href="${escapedMeetingLink}">${escapedMeetingLink}</a></p>`;
};

/**
 * Sends an OTP verification email to the user.
 * 
 * @param {string} email 
 * @param {string} otp 
 * @returns {Promise<Object>}
 */
const sendOTPEmail = async (email, otp) => {
    const cleanEmail = (email || '').trim().toLowerCase();

    if (!cleanEmail) {
        throw new Error('Recipient email address is required.');
    }

    if (!isValidEmail(cleanEmail)) {
        throw new Error('Invalid email address format.');
    }

    const senderEmail = process.env.EMAIL_USER || process.env.SMTP_USER || 'no-reply@internpilot.com';

    const mailOptions = {
        from: `"InternPilot Support" <${senderEmail}>`,
        to: cleanEmail,
        subject: 'Verify Your InternPilot Account - OTP Code',
        text: `Welcome to InternPilot!\n\nYour verification code is: ${otp}\n\nThis code will expire in 10 minutes.\nIf you didn't request this, please ignore this email.`,
        html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
                <h2 style="color: #4f46e5; text-align: center;">Welcome to InternPilot!</h2>
                <p>Please use the one-time password (OTP) below to verify your email address and complete your registration.</p>
                <div style="background: #f3f4f6; padding: 15px; font-size: 28px; font-weight: bold; text-align: center; letter-spacing: 6px; color: #1e293b; border-radius: 8px; margin: 25px 0;">
                    ${otp}
                </div>
                <p>This verification code will expire in <strong>10 minutes</strong>.</p>
                <p style="font-size: 12px; color: #64748b; margin-top: 30px; text-align: center;">If you didn't request this, please ignore this email.</p>
            </div>
        `
    };

    return await sendWithRetry(mailOptions);
};

/**
 * Sends an internship application status update email to the candidate.
 * 
 * @param {string} email 
 * @param {string} candidateName 
 * @param {string} internshipTitle 
 * @param {string} status 
 * @returns {Promise<Object>}
 */
const sendStatusUpdateEmail = async (email, candidateName, internshipTitle, status) => {
    const cleanEmail = (email || '').trim().toLowerCase();

    if (!cleanEmail) {
        throw new Error('Recipient email address is required.');
    }

    if (!isValidEmail(cleanEmail)) {
        throw new Error('Invalid email address format.');
    }

    const senderEmail = process.env.EMAIL_USER || process.env.SMTP_USER || 'no-reply@internpilot.com';

    const statusColors = {
        'Under Review': '#d97706',
        'Shortlisted': '#059669',
        'Interview': '#7c3aed',
        'Hired': '#10b981',
        'Rejected': '#dc2626',
        'Submitted': '#4f46e5'
    };

    const color = statusColors[status] || '#4f46e5';

    const mailOptions = {
        from: `"InternPilot Support" <${senderEmail}>`,
        to: cleanEmail,
        subject: `Application Status Update - ${internshipTitle}`,
        html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
                <h2 style="color: #4f46e5; text-align: center;">InternPilot</h2>
                <p>Hi <strong>${candidateName}</strong>,</p>
                <p>Your application status for the position <strong>${internshipTitle}</strong> has been updated to:</p>
                <div style="background: #f8fafc; padding: 15px; font-size: 20px; font-weight: bold; text-align: center; color: ${color}; border-radius: 8px; margin: 20px 0; border: 1px solid #e2e8f0;">
                    ${status}
                </div>
                <p>Log in to your InternPilot account to view further details.</p>
                <p style="font-size: 12px; color: #64748b; margin-top: 30px; text-align: center;">Thank you for using InternPilot!</p>
            </div>
        `
    };

    return await sendWithRetry(mailOptions);
};

/**
 * Sends an interview scheduled email to the candidate.
 */
const sendInterviewScheduledEmail = async (email, candidateName, internshipTitle, interviewDetails) => {
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !isValidEmail(cleanEmail)) throw new Error('Invalid email address.');

    const senderEmail = process.env.EMAIL_USER || process.env.SMTP_USER || 'no-reply@internpilot.com';
    const formattedDate = new Date(interviewDetails.scheduledAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short' });

    let modeDetails = '';
    if (interviewDetails.mode === 'Online') {
        modeDetails = onlineMeetingDetails(interviewDetails.meetingLink);
    } else if (interviewDetails.mode === 'In-Person') {
        modeDetails = `<p><strong>Location:</strong> ${interviewDetails.location}</p>`;
    }

    const instructions = interviewDetails.instructions ? `<p><strong>Instructions:</strong><br/>${interviewDetails.instructions}</p>` : '';

    const mailOptions = {
        from: `"InternPilot Support" <${senderEmail}>`,
        to: cleanEmail,
        subject: `Interview Scheduled - ${internshipTitle}`,
        html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
                <h2 style="color: #4f46e5; text-align: center;">InternPilot</h2>
                <p>Hi <strong>${candidateName}</strong>,</p>
                <p>An interview has been scheduled for your application to <strong>${internshipTitle}</strong>.</p>
                <div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #e2e8f0;">
                    <p><strong>Date & Time:</strong> ${formattedDate} (IST)</p>
                    <p><strong>Duration:</strong> ${interviewDetails.duration} minutes</p>
                    <p><strong>Mode:</strong> ${interviewDetails.mode}</p>
                    ${modeDetails}
                    ${instructions}
                </div>
                <p>Log in to your InternPilot account to view further details.</p>
                <p style="font-size: 12px; color: #64748b; margin-top: 30px; text-align: center;">Thank you for using InternPilot!</p>
            </div>
        `
    };

    return await sendWithRetry(mailOptions);
};

/**
 * Sends an interview rescheduled email to the candidate.
 */
const sendInterviewRescheduledEmail = async (email, candidateName, internshipTitle, interviewDetails) => {
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !isValidEmail(cleanEmail)) throw new Error('Invalid email address.');

    const senderEmail = process.env.EMAIL_USER || process.env.SMTP_USER || 'no-reply@internpilot.com';
    const formattedDate = new Date(interviewDetails.scheduledAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short' });

    let modeDetails = '';
    if (interviewDetails.mode === 'Online') {
        modeDetails = onlineMeetingDetails(interviewDetails.meetingLink);
    } else if (interviewDetails.mode === 'In-Person') {
        modeDetails = `<p><strong>Location:</strong> ${interviewDetails.location}</p>`;
    }

    const instructions = interviewDetails.instructions ? `<p><strong>Instructions:</strong><br/>${interviewDetails.instructions}</p>` : '';

    const mailOptions = {
        from: `"InternPilot Support" <${senderEmail}>`,
        to: cleanEmail,
        subject: `Interview Rescheduled - ${internshipTitle}`,
        html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
                <h2 style="color: #4f46e5; text-align: center;">InternPilot</h2>
                <p>Hi <strong>${candidateName}</strong>,</p>
                <p>Your interview for <strong>${internshipTitle}</strong> has been rescheduled.</p>
                <div style="background: #fdf6e3; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #fce8b2;">
                    <p><strong>New Date & Time:</strong> ${formattedDate} (IST)</p>
                    <p><strong>Duration:</strong> ${interviewDetails.duration} minutes</p>
                    <p><strong>Mode:</strong> ${interviewDetails.mode}</p>
                    ${modeDetails}
                    ${instructions}
                </div>
                <p>Log in to your InternPilot account to view further details.</p>
                <p style="font-size: 12px; color: #64748b; margin-top: 30px; text-align: center;">Thank you for using InternPilot!</p>
            </div>
        `
    };

    return await sendWithRetry(mailOptions);
};

/**
 * Sends an interview cancelled email to the candidate.
 */
const sendInterviewCancelledEmail = async (email, candidateName, internshipTitle, cancelReason) => {
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !isValidEmail(cleanEmail)) throw new Error('Invalid email address.');

    const senderEmail = process.env.EMAIL_USER || process.env.SMTP_USER || 'no-reply@internpilot.com';

    const reasonHTML = cancelReason ? `<p><strong>Reason:</strong> ${cancelReason}</p>` : '';

    const mailOptions = {
        from: `"InternPilot Support" <${senderEmail}>`,
        to: cleanEmail,
        subject: `Interview Cancelled - ${internshipTitle}`,
        html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
                <h2 style="color: #dc2626; text-align: center;">InternPilot</h2>
                <p>Hi <strong>${candidateName}</strong>,</p>
                <p>Your scheduled interview for <strong>${internshipTitle}</strong> has been cancelled.</p>
                ${reasonHTML ? `<div style="background: #fef2f2; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #fecaca;">${reasonHTML}</div>` : ''}
                <p>Log in to your InternPilot account to view further details or check the status of your application.</p>
                <p style="font-size: 12px; color: #64748b; margin-top: 30px; text-align: center;">Thank you for using InternPilot!</p>
            </div>
        `
    };

    return await sendWithRetry(mailOptions);
};

/**
 * Sends either one instant saved-search alert or a daily/weekly digest. The
 * caller passes server-owned search names and internship records; every value
 * is escaped here so listing content cannot become email HTML.
 *
 * @param {string} email
 * @param {string} candidateName
 * @param {string[]} searchNames
 * @param {Array<{title?: string, companyName?: string}>} internships
 * @param {'instant'|'daily'|'weekly'} frequency
 * @param {string} resultsPath A relative InternPilot results path.
 * @returns {Promise<Object>}
 */
const sendSavedSearchAlertEmail = async (
    email,
    candidateName,
    searchNames = [],
    internships = [],
    frequency = 'instant',
    resultsPath = '/internships'
) => {
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !isValidEmail(cleanEmail)) throw new Error('Invalid email address.');

    const safeSearchNames = [...new Set((Array.isArray(searchNames) ? searchNames : [])
        .map(name => String(name || '').trim())
        .filter(Boolean))];
    const safeInternships = (Array.isArray(internships) ? internships : [])
        .filter(Boolean)
        .slice(0, 10);
    const isDigest = frequency === 'daily' || frequency === 'weekly';
    const cadence = frequency === 'weekly' ? 'weekly' : 'daily';
    const intro = isDigest
        ? `Here is your ${cadence} saved-search digest.`
        : 'A new internship matches one of your saved searches.';
    const searchContext = safeSearchNames.length
        ? `Matching search${safeSearchNames.length === 1 ? '' : 'es'}: ${safeSearchNames.join(', ')}`
        : 'A saved search matched this opportunity.';
    const listingRows = safeInternships.map(internship => {
        const title = escapeHtml(internship.title || 'Internship opportunity');
        const company = escapeHtml(internship.companyName || internship.company || 'InternPilot partner');
        return `<li style="margin: 0 0 8px;"><strong>${title}</strong> at ${company}</li>`;
    }).join('');

    let resultsUrl = '';
    const configuredBase = sanitizeHttpUrl(process.env.APP_URL || '').url;
    if (configuredBase && typeof resultsPath === 'string' && resultsPath.startsWith('/')) {
        try {
            resultsUrl = new URL(resultsPath, configuredBase).toString();
        } catch (error) {
            // The email remains useful without a deep link when APP_URL is malformed.
            resultsUrl = '';
        }
    }

    const senderEmail = process.env.EMAIL_USER || process.env.SMTP_USER || 'no-reply@internpilot.com';
    const button = resultsUrl
        ? `<a href="${escapeHtml(resultsUrl)}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:10px 16px;border-radius:7px;text-decoration:none;font-weight:700;font-size:14px;">View matching internships</a>`
        : '<p>Sign in to InternPilot to view your matching internships.</p>';
    const textListings = safeInternships.map(internship =>
        `- ${internship.title || 'Internship opportunity'} at ${internship.companyName || internship.company || 'InternPilot partner'}`
    ).join('\n');

    const mailOptions = {
        from: `"InternPilot Alerts" <${senderEmail}>`,
        to: cleanEmail,
        subject: isDigest
            ? `Your ${cadence} InternPilot internship matches`
            : 'New internship match from your saved search',
        text: `Hi ${candidateName || 'there'},\n\n${intro}\n${searchContext}\n\n${textListings || 'Open InternPilot to view your matching internships.'}\n${resultsUrl ? `\nView results: ${resultsUrl}` : ''}`,
        html: `
            <div style="font-family:Arial,sans-serif;padding:20px;color:#334155;max-width:600px;margin:auto;border:1px solid #e2e8f0;border-radius:10px;">
                <h2 style="color:#4f46e5;margin-top:0;">InternPilot</h2>
                <p>Hi <strong>${escapeHtml(candidateName || 'there')}</strong>,</p>
                <p>${escapeHtml(intro)}</p>
                <p style="color:#475569;font-size:14px;">${escapeHtml(searchContext)}</p>
                ${listingRows ? `<ul style="padding-left:20px;line-height:1.5;">${listingRows}</ul>` : ''}
                <div style="margin:24px 0 8px;">${button}</div>
                <p style="font-size:12px;color:#64748b;margin-top:30px;">Manage or pause alerts at any time from Saved Searches in InternPilot.</p>
            </div>
        `
    };

    return sendWithRetry(mailOptions);
};

/**
 * Sends a certificate issued notification email to the candidate.
 * 
 * @param {string} email 
 * @param {string} candidateName 
 * @param {string} companyName 
 * @param {string} internshipTitle 
 * @param {string} certificateId 
 * @param {string} viewUrl 
 * @returns {Promise<Object>}
 */
const sendCertificateIssuedEmail = async (email, candidateName, companyName, internshipTitle, certificateId, viewUrl) => {
    const cleanEmail = (email || '').trim().toLowerCase();

    if (!cleanEmail || !isValidEmail(cleanEmail)) {
        return null;
    }

    const senderEmail = process.env.EMAIL_USER || process.env.SMTP_USER || 'no-reply@internpilot.com';
    const safeCandidateName = escapeHtml(candidateName || 'Intern');
    const safeCompanyName = escapeHtml(companyName || 'Company');
    const safeTitle = escapeHtml(internshipTitle || 'Internship');
    const safeCertId = escapeHtml(certificateId || '');
    const safeViewUrl = escapeHtml(viewUrl || '#');

    const mailOptions = {
        from: `"InternPilot Credentials" <${senderEmail}>`,
        to: cleanEmail,
        subject: `Certificate of Completion Issued - ${internshipTitle}`,
        text: `Congratulations ${candidateName}!\n\n${companyName} has issued your official Certificate of Completion for "${internshipTitle}".\n\nCertificate ID: ${certificateId}\nView and download your certificate: ${viewUrl}\n\nInternPilot Team`,
        html: `
            <div style="font-family: Arial, sans-serif; padding: 24px; color: #1e293b; max-width: 620px; margin: auto; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
                <div style="text-align: center; margin-bottom: 24px;">
                    <h1 style="color: #4338ca; margin: 0; font-size: 24px; letter-spacing: -0.5px;">InternPilot</h1>
                    <p style="color: #64748b; font-size: 13px; margin: 4px 0 0 0;">Official PMIS Credential Service</p>
                </div>
                <div style="background: linear-gradient(135deg, #eef2ff 0%, #f5f3ff 100%); border: 1px solid #c7d2fe; border-radius: 10px; padding: 20px; text-align: center; margin-bottom: 20px;">
                    <div style="font-size: 32px; margin-bottom: 8px;">🎓</div>
                    <h2 style="color: #312e81; margin: 0 0 6px 0; font-size: 18px;">Certificate of Completion Issued!</h2>
                    <p style="color: #4338ca; margin: 0; font-size: 14px; font-weight: 500;">Congratulations, <strong>${safeCandidateName}</strong>!</p>
                </div>
                <p style="font-size: 14px; line-height: 1.6; color: #334155;">
                    <strong>${safeCompanyName}</strong> has officially certified your successful internship completion for the role of <strong>${safeTitle}</strong>.
                </p>
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin: 18px 0; font-size: 13px;">
                    <p style="margin: 0 0 6px 0; color: #64748b;">Official Credential ID:</p>
                    <p style="margin: 0; font-family: monospace; font-size: 16px; font-weight: bold; color: #1e1b4b; letter-spacing: 1px;">${safeCertId}</p>
                </div>
                <div style="text-align: center; margin: 28px 0 16px 0;">
                    <a href="${safeViewUrl}" style="display: inline-block; background: #4f46e5; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: bold; font-size: 14px; box-shadow: 0 2px 4px rgba(79, 70, 229, 0.2);">
                        View & Download Certificate
                    </a>
                </div>
                <p style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 30px; border-top: 1px solid #f1f5f9; padding-top: 16px;">
                    This certificate is cryptographically verifiable online via the InternPilot Public Verification Portal.
                </p>
            </div>
        `
    };

    return sendWithRetry(mailOptions);
};

module.exports = {
    sendOTPEmail,
    sendStatusUpdateEmail,
    sendInterviewScheduledEmail,
    sendInterviewRescheduledEmail,
    sendInterviewCancelledEmail,
    sendSavedSearchAlertEmail,
    sendCertificateIssuedEmail
};
