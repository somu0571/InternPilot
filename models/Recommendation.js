const mongoose = require('mongoose');

const recommendationSchema = new mongoose.Schema({
    candidate: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true,
        index: true
    },
    internship: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Internship', 
        required: true 
    },
    aiMatchScore: { 
        type: Number, 
        required: true,
        min: 0,
        max: 100
    },
    skillGapAnalysis: { 
        type: String, 
        required: true 
    },
    matchReasoning: { 
        type: String, 
        required: true 
    },
    isFallback: {
        type: Boolean,
        default: false
    },
    generatedAt: {
        type: Date,
        required: true
    }
}, { timestamps: true });


recommendationSchema.index({ candidate: 1, internship: 1 }, { unique: true });


recommendationSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 604800 }); 

module.exports = mongoose.model('Recommendation', recommendationSchema);
