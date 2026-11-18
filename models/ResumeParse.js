const mongoose = require('mongoose');




const resumeParseSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    
    
    resumeUrl: { type: String, default: '' },
    fileName: { type: String, default: '', trim: true },
    parsedAt: { type: Date, default: Date.now },
    status: {
        type: String,
        enum: ['ok', 'low_confidence', 'nothing_found', 'unreadable'],
        required: true
    },
    
    textLength: { type: Number, default: 0 },
    
    skills: [{ type: String, trim: true }],
    newSkills: [{ type: String, trim: true }],
    qualification: { type: String, default: '', trim: true },
    
    previousQualification: { type: String, default: '', trim: true }
}, { timestamps: true });

module.exports = mongoose.model('ResumeParse', resumeParseSchema);
