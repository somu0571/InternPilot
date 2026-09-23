const nodemailer = require('nodemailer');

const isConsoleEmailTransport = () => (
    process.env.NODE_ENV === 'development'
    && String(process.env.EMAIL_TRANSPORT || '').toLowerCase() === 'console'
);

const getSenderAddress = () => {
    if (isConsoleEmailTransport()) {
        return '"InternPilot Support" <no-reply@internpilot.local>';
    }

    return `"InternPilot Support" <${String(process.env.EMAIL_USER || '').trim()}>`;
};

const getGmailCredentials = () => {
    const user = String(process.env.EMAIL_USER || '').trim();
    // Google displays App Passwords with spaces, but SMTP expects the compact value.
    const pass = String(process.env.EMAIL_PASS || '').replace(/\s+/g, '');

    if (!user || !pass) {
        const error = new Error('Email is not configured. Set EMAIL_USER and EMAIL_PASS, or use the development console transport.');
        error.code = 'EMAIL_CONFIG_MISSING';
        throw error;
    }

    return { user, pass };
};

const createTransporter = () => {
    if (isConsoleEmailTransport()) {
        // This transport never connects to an SMTP service. It exists only for
        // local OTP testing and is deliberately unavailable outside development.
        return nodemailer.createTransport({
            streamTransport: true,
            buffer: true,
            newline: 'unix'
        });
    }

    if (String(process.env.EMAIL_TRANSPORT || '').toLowerCase() === 'console') {
        const error = new Error('EMAIL_TRANSPORT=console is allowed only when NODE_ENV=development.');
        error.code = 'EMAIL_TRANSPORT_NOT_ALLOWED';
        throw error;
    }

    const { user, pass } = getGmailCredentials();

    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user,
            pass
        }
    });
};

const sendOTPEmail = async (email, otp) => {
    const transporter = createTransporter();

    const mailOptions = {
        from: getSenderAddress(),
        to: email,
        subject: 'Verify Your InternPilot Account - OTP Code',
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

    const result = await transporter.sendMail(mailOptions);

    if (isConsoleEmailTransport()) {
        console.info(`[DEV ONLY] Verification OTP for ${email}: ${otp}`);
    }

    return result;
};

const sendStatusUpdateEmail = async (email, candidateName, internshipTitle, status) => {
    const transporter = createTransporter();

    const statusColors = {
        'Under Review': '#d97706',
        'Shortlisted': '#059669',
        'Rejected': '#dc2626',
        'Submitted': '#4f46e5'
    };

    const color = statusColors[status] || '#4f46e5';

    const mailOptions = {
        from: getSenderAddress(),
        to: email,
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

    return await transporter.sendMail(mailOptions);
};

module.exports = {
    sendOTPEmail,
    sendStatusUpdateEmail,
    isConsoleEmailTransport
};
