const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String },
    googleId: { type: String },
    avatar: { type: String },

    role: {
        type: String,
        enum: ['candidate', 'company', 'admin'],
        default: 'candidate',
        required: true
    },

    age: { type: Number },
    familyIncome: { type: Number },
    institution: { type: String },
    skills: [{ type: String }],
    resume: { type: String, default: '' },

    location: {
        district: { type: String, default: '' },
        state: { type: String, default: '' }
    },
    education: {
        qualification: { type: String, default: '' }
    },

    companyDetails: {
        companyName: { type: String },
        cin: { type: String },
        industry: { type: String },
        isVerified: { type: Boolean, default: false }
    },

    isEmailVerified: { type: Boolean, default: false },

    otp: { type: String },
    otpExpires: { type: Date },

    createdAt: { type: Date, default: Date.now }
});

// Hash password before saving
userSchema.pre('save', async function () {
    if (!this.isModified('password') || !this.password) return;

    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});

// Compare Password Helper Method
userSchema.methods.comparePassword = async function (candidatePassword) {
    if (!this.password) return false;
    return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);