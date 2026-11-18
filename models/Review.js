const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
    company: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    candidate: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    internship: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Internship'
    },
    application: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Application'
    },
    
    rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5
    },
    
    mentorshipRating: {
        type: Number,
        required: true,
        min: 1,
        max: 5,
        default: 5
    },
    learningRating: {
        type: Number,
        min: 1,
        max: 5,
        default: 5
    },
    learningCurveRating: {
        type: Number,
        min: 1,
        max: 5,
        default: 5
    },
    stipendPunctualityRating: {
        type: Number,
        required: true,
        min: 1,
        max: 5,
        default: 5
    },
    workLifeBalanceRating: {
        type: Number,
        required: true,
        min: 1,
        max: 5,
        default: 5
    },
    
    title: {
        type: String,
        required: true,
        trim: true,
        maxlength: 120
    },
    pros: {
        type: String,
        required: true,
        trim: true,
        maxlength: 2000
    },
    cons: {
        type: String,
        required: true,
        trim: true,
        maxlength: 2000
    },
    adviceToManagement: {
        type: String,
        trim: true,
        default: '',
        maxlength: 2000
    },
    
    isAnonymous: {
        type: Boolean,
        default: false
    },
    roleTitle: {
        type: String,
        required: true,
        trim: true
    },
    employmentStatus: {
        type: String,
        enum: ['Current Intern', 'Former Intern'],
        default: 'Former Intern'
    },
    
    employerResponse: {
        response: { type: String, trim: true, default: '' },
        comment: { type: String, trim: true, default: '' },
        respondedAt: { type: Date },
        respondedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    },
    
    helpfulVotes: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    status: {
        type: String,
        enum: ['Published', 'Under Review', 'Flagged'],
        default: 'Published',
        index: true
    }
}, { timestamps: true });


reviewSchema.pre('validate', function() {
    if (this.employerResponse) {
        if (this.employerResponse.comment && !this.employerResponse.response) {
            this.employerResponse.response = this.employerResponse.comment;
        } else if (this.employerResponse.response && !this.employerResponse.comment) {
            this.employerResponse.comment = this.employerResponse.response;
        }
    }
    if (this.learningRating != null && this.learningCurveRating == null) {
        this.learningCurveRating = this.learningRating;
    } else if (this.learningCurveRating != null && this.learningRating == null) {
        this.learningRating = this.learningCurveRating;
    }
});


reviewSchema.index({ company: 1, candidate: 1 }, { unique: true });
reviewSchema.index({ company: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Review', reviewSchema);
