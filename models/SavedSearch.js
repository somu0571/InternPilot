const mongoose = require('mongoose');




const savedSearchCriteriaSchema = new mongoose.Schema({
    search: { type: String, trim: true, maxlength: 160, default: '' },
    sector: { type: String, trim: true, maxlength: 80, default: '' },
    location: { type: String, trim: true, maxlength: 160, default: '' },
    skills: [{ type: String, trim: true, maxlength: 80 }],
    minStipend: { type: Number, min: 0 },
    maxStipend: { type: Number, min: 0 },
    duration: [{
        type: String,
        enum: ['upto3', '3to6', '6to12', 'over12']
    }]
}, { _id: false, strict: true });

const deliverySchema = new mongoose.Schema({
    inApp: { type: Boolean, default: true },
    email: { type: Boolean, default: false }
}, { _id: false, strict: true });

const savedSearchSchema = new mongoose.Schema({
    candidate: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 80
    },
    criteria: {
        type: savedSearchCriteriaSchema,
        required: true
    },
    
    
    criteriaHash: {
        type: String,
        required: true,
        trim: true,
        maxlength: 128
    },
    frequency: {
        type: String,
        enum: ['instant', 'daily', 'weekly', 'off'],
        default: 'instant',
        required: true
    },
    delivery: {
        type: deliverySchema,
        default: () => ({})
    },
    isPaused: { type: Boolean, default: false },
    
    
    alertStartAt: { type: Date, default: Date.now },
    lastAlertAt: { type: Date },
    lastDigestAt: { type: Date }
}, { timestamps: true });

savedSearchSchema.index({ candidate: 1, criteriaHash: 1 }, { unique: true });
savedSearchSchema.index({ candidate: 1, isPaused: 1, frequency: 1 });

module.exports = mongoose.model('SavedSearch', savedSearchSchema);
