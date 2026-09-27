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
            // Guard against infinite recursion: the isPaused setter may
            // write back to status which re-enters this setter.
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
            // Guard against infinite recursion: the status setter may
            // write back to isPaused which re-enters this setter.
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
    // `vacancies` remains the advertised total. Filled seats are incremented
    // through a conditional atomic update when an offer is accepted.
    filledSeats: { type: Number, default: 0, min: 0 },
    // Only capacity closures are reopened automatically if a reserved seat is
    // released during error recovery. Manually closed listings stay closed.
    closedReason: { type: String, enum: ['capacity', null], default: null },
    description: { type: String, default: '' },
    responsibilities: { type: [String], default: [] },
    eligibilityCriteria: { type: [String], default: [] },
    // Each question has its own stable subdocument ID. Application kits copy
    // that ID plus the prompt, which keeps historical answers meaningful even
    // if the listing is later edited or reordered.
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
    // Unlike createdAt, this reflects when candidates could actually discover
    // a listing. It is refreshed when a draft is published or a paused listing
    // is resumed, which gives saved-search digests the correct time window.
    publishedAt: {
        type: Date,
        index: true
    }
}, { toJSON: { virtuals: true }, toObject: { virtuals: true } });

// Secondary safety net: ensure isPaused always agrees with status.
// Status is the canonical field; isPaused is a convenience mirror.
internshipSchema.pre('save', function (next) {
    const capacity = Number(this.vacancies) > 0 ? Number(this.vacancies) : 1;
    if (Number(this.filledSeats || 0) > capacity) {
        return next(new Error('Filled seats cannot exceed the listing vacancies.'));
    }

    // A listing closed because all seats were accepted must not be reopened by
    // an unrelated resume/edit form. Increasing `vacancies` first is the
    // explicit way for a company to advertise more seats.
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
