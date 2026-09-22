const mongoose = require("mongoose");

const internshipSchema = new mongoose.Schema({
    companyName: { type: String, required: true },
    sector: String,
    title: { type: String, required: true },
    location: {
        district: String,
        state: String
    },
    minQualifications: String,
    requiredSkills: [String],
    monthlyStipend: { type: Number, default: 5000 },
    duration: { type: String, default: "12 Months" },
    vacancies: { type: Number, default: 1 },
    embedding: [Number],
    postedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    }
});

module.exports = mongoose.model("Internship", internshipSchema);
