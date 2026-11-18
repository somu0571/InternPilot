const mongoose = require('mongoose');





const CATEGORY_KEYS = ['fees', 'stipend', 'misleading', 'account', 'application', 'technical', 'other'];
const STATUS_KEYS = ['open', 'in_review', 'resolved', 'closed'];

const updateSchema = new mongoose.Schema({
    kind: {
        type: String,
        enum: ['created', 'reply', 'response', 'status', 'escalated', 'reopened'],
        required: true
    },
    
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byRole: { type: String, enum: ['raiser', 'admin', 'system'], required: true },
    message: { type: String, trim: true, maxlength: 2000, default: '' },
    status: { type: String, enum: STATUS_KEYS },
    tier: { type: Number, min: 1, max: 3 },
    
    
    at: { type: Date, default: Date.now }
});

const grievanceSchema = new mongoose.Schema({
    ticket: { type: String, required: true, unique: true },
    raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    raiserRole: { type: String, enum: ['candidate', 'company'], required: true },
    
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    category: { type: String, enum: CATEGORY_KEYS, required: true },
    subject: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 4000 },
    application: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
    internship: { type: mongoose.Schema.Types.ObjectId, ref: 'Internship' },
    status: { type: String, enum: STATUS_KEYS, default: 'open', index: true },
    tier: { type: Number, min: 1, max: 3, default: 1, index: true },
    dueAt: { type: Date, required: true, index: true },
    resolvedAt: { type: Date },
    reopenCount: { type: Number, default: 0 },
    updates: [updateSchema]
}, { timestamps: true });

grievanceSchema.index({ status: 1, dueAt: 1 });


const counterSchema = new mongoose.Schema({
    _id: { type: String },
    seq: { type: Number, default: 0 }
}, { versionKey: false });

const Grievance = mongoose.model('Grievance', grievanceSchema);
const GrievanceCounter = mongoose.model('GrievanceCounter', counterSchema);

module.exports = Grievance;
module.exports.GrievanceCounter = GrievanceCounter;
module.exports.CATEGORY_KEYS = CATEGORY_KEYS;
module.exports.STATUS_KEYS = STATUS_KEYS;
