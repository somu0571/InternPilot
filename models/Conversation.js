const mongoose = require('mongoose');



const conversationSchema = new mongoose.Schema({
    application: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Application',
        required: true,
        unique: true
    },
    internship: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Internship',
        required: true
    },
    candidate: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    
    
    company: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    startedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    lastMessageAt: { type: Date, index: true },
    lastMessagePreview: { type: String, default: '' },
    lastMessageBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    
    
    reads: [{
        _id: false,
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        at: { type: Date, required: true }
    }]
}, { timestamps: true });

module.exports = mongoose.model('Conversation', conversationSchema);
