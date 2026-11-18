const Notification = require('../models/Notification');
const Application = require('../models/Application');


async function safeExecute(name, fn) {
    try {
        await fn();
    } catch (error) {
        console.error(`[Recruiter Notifications] Failed executing ${name}:`, error);
    }
}

async function notifyNewApplication(application, internship) {
    return safeExecute('notifyNewApplication', async () => {
        if (!internship.companyId) return;
        
        await Notification.create({
            companyId: internship.companyId,
            type: 'new_application',
            title: 'New Application Received',
            message: `A candidate has applied for ${internship.title}.`,
            link: `/company/internships/${internship._id}/applicants`,
            internship: internship._id,
            application: application._id
        });
    });
}

async function notifyCandidateWithdrawal(application, internship) {
    return safeExecute('notifyCandidateWithdrawal', async () => {
        if (!internship.companyId) return;

        await Notification.create({
            companyId: internship.companyId,
            type: 'candidate_withdrawal',
            title: 'Candidate Withdrew Application',
            message: `A candidate has withdrawn their application for ${internship.title}.`,
            link: `/company/internships/${internship._id}/applicants`,
            internship: internship._id,
            application: application._id
        });
    });
}

async function checkAndNotifyHighVolume(internshipId) {
    return safeExecute('checkAndNotifyHighVolume', async () => {
        const internship = require('../models/Internship'); 
        const internshipDoc = await internship.findById(internshipId);
        if (!internshipDoc || !internshipDoc.companyId) return;

        const count = await Application.countDocuments({ 
            internship: internshipId, 
            status: { $nin: ['Withdrawn', 'withdrawn'] } 
        });

        
        const thresholds = [150, 100, 50];
        const breachedThreshold = thresholds.find(t => count >= t);

        if (breachedThreshold) {
            
            
            
            await Notification.updateOne(
                {
                    companyId: internshipDoc.companyId,
                    internship: internshipDoc._id,
                    type: 'high_application_volume',
                    'metadata.threshold': breachedThreshold
                },
                {
                    $setOnInsert: {
                        companyId: internshipDoc.companyId,
                        type: 'high_application_volume',
                        title: 'High Application Volume',
                        message: `Your listing for ${internshipDoc.title} has reached ${breachedThreshold} applications!`,
                        link: `/company/internships/${internshipDoc._id}/applicants`,
                        internship: internshipDoc._id,
                        metadata: { threshold: breachedThreshold },
                        isRead: false
                    }
                },
                { upsert: true }
            );
        }
    });
}

module.exports = {
    notifyNewApplication,
    notifyCandidateWithdrawal,
    checkAndNotifyHighVolume
};
