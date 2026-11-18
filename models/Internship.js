const mongoose = require("mongoose");

const internshipSchema = new mongoose.Schema({
    companyName: { type: String, required: true },
    sector: String,
    title: { 
        type: String, 
        required: function () {
            return this.status === 'published' || this.status === 'paused';
        }
    },
    status: {
        type: String,
        enum: ['published', 'draft', 'closed', 'paused'],
        default: 'published',
        index: true,
        set: function (val) {
            
            
            if (this._settingStatus) return val;
            this._settingStatus = true;
            if (val === 'paused') {
                this.isPaused = true;
            } else if (val === 'published' || val === 'draft' || val === 'closed') {
                this.isPaused = false;
            }
            this._settingStatus = false;
            return val;
        }
    },
    isPaused: {
        type: Boolean,
        default: false,
        index: true,
        set: function (val) {
            
            
            if (this._settingPaused) return val;
            this._settingPaused = true;
            if (val === true && this.status !== 'draft') {
                this.status = 'paused';
            } else if (val === false && this.status === 'paused') {
                this.status = 'published';
            }
            this._settingPaused = false;
            return val;
        }
    },
    location: {
        district: String,
        state: String
    },
    minQualifications: { type: String, alias: 'minQualification' },
    requiredSkills: [String],
    monthlyStipend: { type: Number, default: 5000 },
    duration: { type: String, default: "12 Months" },
    vacancies: { type: Number, default: 1, min: 1 },
    
    
    filledSeats: { type: Number, default: 0, min: 0 },
    
    
    closedReason: { type: String, enum: ['capacity', null], default: null },
    description: { type: String, default: '' },
    responsibilities: { type: [String], default: [] },
    eligibilityCriteria: { type: [String], default: [] },
    
    
    
    applicationQuestions: [{
        prompt: { type: String, required: true, trim: true, maxlength: 500 },
        required: { type: Boolean, default: false },
        maxLength: { type: Number, default: 2000, min: 1, max: 2000 }
    }],

    embedding: [Number],
    postedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    },
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    },
    applicationDeadline: {
        type: Date
    },
    
    
    
    publishedAt: {
        type: Date,
        index: true
    }
}, { toJSON: { virtuals: true }, toObject: { virtuals: true } });



internshipSchema.pre('save', function (next) {
    const capacity = Number(this.vacancies) > 0 ? Number(this.vacancies) : 1;
    if (Number(this.filledSeats || 0) > capacity) {
        return next(new Error('Filled seats cannot exceed the listing vacancies.'));
    }

    
    
    
    if (this.status === 'published' && Number(this.filledSeats || 0) >= capacity) {
        this.status = 'closed';
        this.closedReason = 'capacity';
    } else if (this.status === 'published' && this.closedReason === 'capacity') {
        this.closedReason = null;
    }

    if (this.status === 'paused') {
        this.isPaused = true;
    } else {
        this.isPaused = false;
    }

    if (
        this.status === 'published'
        && !this.isPaused
        && (this.isNew || this.isModified('status'))
    ) {
        this.publishedAt = new Date();
    }

    if (typeof next === 'function') {
        next();
    }
});

internshipSchema.methods.pause = function () {
    this.status = 'paused';
    this.isPaused = true;
    return this.save();
};

internshipSchema.methods.resume = function () {
    this.status = 'published';
    this.isPaused = false;
    return this.save();
};

internshipSchema.virtual('company').get(function () {
    return this.companyName;
});

internshipSchema.virtual('stipend').get(function () {
    return this.monthlyStipend;
});

module.exports = mongoose.model("Internship", internshipSchema);
