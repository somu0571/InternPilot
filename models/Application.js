const mongoose = require("mongoose");
const { isSafeHttpUrl } = require('../utils/safeUrl');

const applicationKitSchema = new mongoose.Schema({
    submittedAt: { type: Date, required: true },
    resume: {
        sourceId: { type: String, default: '' },
        label: { type: String, default: '' },
        fileUrl: { type: String, default: '' },
        fileName: { type: String, default: '' }
    },
    projects: [{
        _id: false,
        sourceId: { type: String, default: '' },
        title: { type: String, default: '' },
        description: { type: String, default: '' },
        link: { type: String, default: '' },
        techStack: [{ type: String }],
        fileUrl: { type: String, default: '' },
        fileName: { type: String, default: '' }
    }],
    certifications: [{
        _id: false,
        sourceId: { type: String, default: '' },
        name: { type: String, default: '' },
        issuer: { type: String, default: '' },
        issueDate: { type: Date },
        link: { type: String, default: '' },
        fileUrl: { type: String, default: '' },
        fileName: { type: String, default: '' }
    }],
    skills: [{
        _id: false,
        name: { type: String, required: true },
        proficiency: {
            type: String,
            enum: ['Beginner', 'Intermediate', 'Advanced'],
            default: 'Intermediate'
        }
    }],
    answers: [{
        _id: false,
        questionId: { type: String, required: true },
        prompt: { type: String, required: true },
        required: { type: Boolean, default: false },
        answer: { type: String, default: '' }
    }],
    candidateProfile: {
        name: { type: String, default: '' },
        email: { type: String, default: '' },
        location: {
            district: { type: String, default: '' },
            state: { type: String, default: '' }
        },
        education: {
            qualification: { type: String, default: '' },
            institutionName: { type: String, default: '' }
        }
    }
}, { _id: false });

const applicationSchema = new mongoose.Schema({
    internship: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Internship",
        required: true
    },
    candidate: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    status: {
        type: String,
        enum: [
            'Submitted', 'Under Review', 'Shortlisted', 'Interview',
            'Rejected', 'Hired', 'Offer Declined', 'Withdrawn', 'pending'
        ],
        default: 'Submitted'
    },
    interview: {
        status: {
            type: String,
            enum: ['Scheduled', 'Rescheduled', 'Cancelled']
        },
        scheduledAt: { type: Date },
        duration: { type: Number, default: 30 }, 
        mode: {
            type: String,
            enum: ['Online', 'Phone', 'In-Person']
        },
        meetingLink: {
            type: String,
            trim: true,
            validate: {
                validator: (value) => !value || isSafeHttpUrl(value),
                message: 'Meeting link must be a valid http:// or https:// URL.'
            }
        },
        location: { type: String },
        instructions: { type: String },
        scheduledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        createdAt: { type: Date },
        updatedAt: { type: Date },
        cancelledAt: { type: Date },
        cancelReason: { type: String }
    },
    matchScore: { type: Number, default: 0 },
    appliedAt: { type: Date, default: Date.now },
    statusHistory: [
        {
            status: {
                type: String,
                enum: [
                    'Submitted', 'Under Review', 'Shortlisted', 'Interview',
                    'Rejected', 'Hired', 'Offer Declined', 'Withdrawn', 'pending'
                ],
                required: true
            },
            changedAt: { type: Date, default: Date.now },
            
            
            
            offer: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer' }
        }
    ],

    
    
    statusUpdatedAt: { type: Date, default: Date.now },

    
    withdrawnAt: { type: Date },
    withdrawalReason: { type: String, trim: true, default: null },

    placement: {
        offer: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer' },
        outcome: { type: String, enum: ['accepted', 'declined'] },
        decidedAt: { type: Date }
    },

    
    
    applicationKit: {
        type: applicationKitSchema,
        immutable: true
    },

    notes: [{
        text: { type: String, required: true },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date }
    }]
}, { timestamps: true });


const WITHDRAWABLE_STATUSES = [
    'Submitted', 'pending',
    'Under Review',
    'Shortlisted',
    'Interview'
];


const TERMINAL_STATUSES = [
    'Rejected',
    'Hired',
    'Offer Declined',
    'Withdrawn'
];


applicationSchema.methods.canWithdraw = function () {
    const s = this.status;
    if (!s) return false;
    if (TERMINAL_STATUSES.includes(s)) return false;
    return WITHDRAWABLE_STATUSES.includes(s);
};


applicationSchema.methods.withdraw = function (reason) {
    if (!this.canWithdraw()) {
        const err = new Error(`Application currently in '${this.status}' status cannot be withdrawn.`);
        err.statusCode = 400;
        err.code = 'INVALID_STATUS_TRANSITION';
        throw err;
    }
    const previousStatus = this.status;
    this.status = 'Withdrawn';
    this.withdrawnAt = new Date();
    if (typeof reason === 'string' && reason.trim()) {
        this.withdrawalReason = reason.trim();
    } else {
        this.withdrawalReason = null;
    }

    if (previousStatus !== 'Withdrawn') {
        if (!Array.isArray(this.statusHistory)) {
            this.statusHistory = [];
        }
        if (this.statusHistory.length === 0) {
            this.statusHistory.push({
                status: previousStatus || 'Submitted',
                changedAt: this.appliedAt || new Date()
            });
        }
        this.statusHistory.push({
            status: 'Withdrawn',
            changedAt: new Date()
        });
    }

    if (this.interview && ['Scheduled', 'Rescheduled'].includes(this.interview.status)) {
        this.interview.status = 'Cancelled';
        this.interview.cancelledAt = new Date();
        this.interview.cancelReason = this.interview.cancelReason || 'Application withdrawn by candidate';
    }

    return this;
};


applicationSchema.statics.WITHDRAWABLE_STATUSES = WITHDRAWABLE_STATUSES;
applicationSchema.statics.TERMINAL_STATUSES = TERMINAL_STATUSES;



applicationSchema.pre('save', function (next) {
    if (!this.isNew && this.isModified('applicationKit')) {
        return next(new Error('Submitted application kits are immutable.'));
    }

    if (this.isNew || this.isModified('status')) {
        this.statusUpdatedAt = new Date();
    } else if (!this.statusUpdatedAt) {
        this.statusUpdatedAt = this.appliedAt || new Date();
    }
    if (typeof next === 'function') next();
});




function rejectApplicationKitQueryMutation(next) {
    const update = this.getUpdate ? this.getUpdate() : {};
    const mutatesKit = value => Object.keys(value || {}).some(key => key === 'applicationKit' || key.startsWith('applicationKit.'));
    const hasKitMutation = mutatesKit(update)
        || ['$set', '$unset', '$push', '$pull', '$addToSet', '$setOnInsert'].some(operator => mutatesKit(update && update[operator]));

    if (hasKitMutation) {
        const error = new Error('Submitted application kits are immutable.');
        if (typeof next === 'function') return next(error);
        throw error;
    }
    if (typeof next === 'function') return next();
}

applicationSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], rejectApplicationKitQueryMutation);


applicationSchema.index({ internship: 1, candidate: 1 }, { unique: true });

module.exports = mongoose.model("Application", applicationSchema);
