# 🚀 InternPilot

<p align="center">
  <b>An AI-Powered Full-Stack Internship Management & Recruitment Portal</b>
</p>

<p align="center">
  Connecting students, companies, and administrators through a secure, intelligent, and efficient internship ecosystem.
</p>

<p align="center">

![Node.js](https://img.shields.io/badge/Node.js-v16%2B-green?logo=node.js)
![Express.js](https://img.shields.io/badge/Express.js-Backend-black?logo=express)
![MongoDB](https://img.shields.io/badge/MongoDB-Database-green?logo=mongodb)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-CSS-blue?logo=tailwindcss)
![Google Gemini](https://img.shields.io/badge/Google%20Gemini-AI%20Powered-orange?logo=google)
![Cloudinary](https://img.shields.io/badge/Cloudinary-Media%20Storage-blue?logo=cloudinary)

</p>

---

## 📌 About The Project

**InternPilot** is a production-grade, AI-powered full-stack internship management web portal designed to connect **students/candidates** with **companies offering internship opportunities** while providing **administrators** with complete system governance and moderation.

The platform provides a structured environment where:

* 🎓 **Candidates** can discover internships, receive AI-powered resume feedback, practice AI mock technical interviews, verify PMIS eligibility, apply for listings, track offers, and manage device sessions.
* 🏢 **Companies** can create verified profiles, publish listings with custom questionnaires, manage the entire ATS applicant pipeline (Shortlist, Interview, Offer, Hire), and track reviews.
* 🛡️ **Administrators** can monitor platform metrics, moderate listings, handle grievance redressals, publish announcements, and review audit logs.

This project was developed as part of **Project Based Learning - 1**.

---

## ✨ Features

### 🤖 AI-Powered Capabilities (Google Gemini)

* 📄 **AI Resume Quality Feedback & ATS Analyzer**: Evaluates resumes for quantifiable achievements, technical skills, project relevance, and delivers actionable, non-numeric improvement feedback.
* 🎯 **AI Semantic Recommendation Engine**: Uses a multi-stage funnel (pre-filter scoring, privacy filter stripping PII, and semantic scoring with skill-gap analysis) with deterministic fallback scoring.
* 💬 **AI Interactive Recruiter Chatbot**: An intelligent conversational assistant that helps candidates discover active listings and answer platform questions in real-time.
* 🎙️ **AI Mock Interview & Problem Generator**: Generates customized technical interview questions and coding problems tailored to the candidate's resume and target role.
* 🛡️ **Multi-Model AI Resilience**: Built-in fallback cascade (`gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-1.5-flash`) ensuring zero downtime during high server load or temporary API spikes.

---

### 🎓 Candidate Portal

* 👤 **Profile & Skill Proficiencies**: Set skills to **Beginner**, **Intermediate**, or **Advanced** for precision matching.
* 🇮🇳 **PMIS Eligibility Checker**: Integrated eligibility engine assessing criteria under the Pradhan Mantri Internship Scheme.
* 📥 **Resume Parsing & Conflict Detection**: Automated PDF/Doc text extraction with an interactive modal to review and resolve data conflicts.
* 📜 **Resume Versioning**: Maintains historical uploaded resumes and metadata.
* 💼 **Offers & Applications Dashboard**: Real-time status tracking (Submitted, Under Review, Shortlisted, Interview Scheduled, Offer Extended, Hired, Rejected).
* 🏆 **Verified Certificates**: Secure issuance and online verification of internship completion certificates.
* 🔐 **Active Sessions & Device Security**: View connected devices, IP locations (masked), and remotely revoke active sessions.

---

### 🏢 Company & Recruiter Portal

* 🏢 **Company Verification & CIN**: Verification workflows ensuring authentic enterprise listings.
* 📋 **Job Lifecycle Management**: Create, edit, draft, publish, and pause internship listings.
* 👥 **Applicant Tracking System (ATS)**: Review candidate applications, inspect resumes, schedule interviews, and extend offers.
* 📝 **Custom Application Questions**: Attach required/optional questions with custom response character limits.
* 🛑 **Atomic Capacity Management**: Advertised vacancy limits automatically track filled seats and prevent over-hiring.
* ⭐ **Company Reviews & Ratings**: Collect and display feedback from verified candidates.

---

### 🛡️ Administrator & Governance Console

* 📊 **Platform Analytics Dashboard**: High-level statistics on candidates, companies, listings, and applications.
* 🛡️ **Moderation Controls**: Review and moderate internship listings and company profiles.
* 📑 **Grievance Redressal System**: Comprehensive ticketing system allowing candidates and companies to submit issues, track statuses, and receive admin resolutions.
* 📢 **Announcements Broadcast**: Publish sitewide announcements for users.
* 🔒 **Audit & Action Logs**: Immutable logging of administrative actions for security compliance.

---

### 🔐 Authentication & Security

* 📩 **6-Digit OTP Verification**: Secure email verification with 10-minute expiry and resend cooldowns via Nodemailer and Gmail SMTP.
* 🔵 **Google OAuth 2.0**: Seamless single sign-on with automatic email verification via Passport.js.
* 🔑 **Role-Based Access Control (RBAC)**: Dedicated routing and permission barriers for Candidates, Companies, and Admins.
* ☁️ **Cloudinary Storage**: Secure, signed cloud storage for uploaded candidate resumes.

---

## 🛠️ Tech Stack

### Core & Backend

| Technology | Purpose |
| :--- | :--- |
| **Node.js** | JavaScript runtime environment |
| **Express.js** | Web backend framework |
| **MongoDB & Mongoose** | Document database & ODM |
| **Google GenAI SDK** | Gemini AI LLM integrations (`@google/genai`) |
| **Passport.js** | Local & Google OAuth 2.0 authentication |
| **Cloudinary** | Secure cloud file and resume storage |
| **Nodemailer** | Transactional emails & OTP verification |

### Frontend & UI

| Technology | Purpose |
| :--- | :--- |
| **EJS & ejs-mate** | Server-side templating & reusable layouts |
| **Tailwind CSS** | Modern responsive styling |
| **Phosphor Icons** | Clean vector iconography |
| **Vanilla JavaScript** | Interactive client-side dynamics |

---

## 📁 Directory Structure

```text
InternPilot/
├── config/             # Passport strategies & external service configs
├── models/             # Mongoose schemas (User, Internship, Application, etc.)
├── routes/             # Express routes
│   ├── auth.js         # Authentication, OTP & Google OAuth
│   ├── candidate.js    # Candidate actions, dashboard & verification
│   ├── company.js      # Company portal, listing & ATS management
│   ├── adminConsole.js # Admin dashboard, moderation & audit logs
│   ├── chat.js         # AI Recruiter Chatbot
│   ├── interview.js    # AI Mock Interview & Problem Generator
│   ├── user.js         # User profile, AI resume quality & recommendations
│   ├── grievances.js   # Grievance redressal ticketing
│   ├── reviews.js      # Company reviews & ratings
│   └── certificates.js # Certificate generation & verification
├── utils/              # Helper utilities
│   ├── aiClient.js     # Shared Gemini AI client with backoff
│   ├── recommendationEngine.js # AI recommendation funnel
│   ├── pmisEligibility.js      # PMIS eligibility checker
│   ├── candidateMatcher.js     # Deterministic scoring algorithms
│   └── sendEmail.js    # Nodemailer email dispatcher
├── views/              # EJS templates
│   ├── auth/           # Login, register & password reset
│   ├── candidate/      # Candidate profile, dashboard & recommendations
│   ├── company/        # Recruiter dashboard & applicant management
│   ├── admin/          # Admin console & grievance management
│   └── layouts/        # ejs-mate layout wrappers
├── public/             # Static CSS, JS, and image assets
├── test/               # Node.js native test suites
├── app.js              # Application entry point
├── .env                # Environment configuration
├── package.json        # Dependencies and scripts
└── README.md           # Documentation
```

---

## ⚙️ Environment Configuration

Create a `.env` file in the root directory:

```env
# Server Configuration
PORT=8080

# MongoDB Configuration (Atlas or Replica Set required for transactions)
ATLASDB_URL=mongodb+srv://username:password@cluster.mongodb.net/internpilot

# Session & Security Secrets
SESSION_SECRET=your_session_secret
ADMIN_SECRET=your_admin_secret_key
ADMIN_CODE=your_admin_secret_key

# Gmail SMTP Configuration
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_gmail_app_password

# Google OAuth 2.0 Credentials
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:8080/auth/google/callback

# Cloudinary Storage Configuration
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret

# Google Gemini AI Configuration
GEMINI_API_KEY=your_google_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
GEMINI_FALLBACK_MODEL=gemini-2.0-flash
RECOMMENDATION_AI_POOL_SIZE=25
```

---

## 🚀 Getting Started

### ✅ Prerequisites

* [Node.js](https://nodejs.org/) (v18+ recommended)
* `npm` package manager
* MongoDB Atlas database (or local replica set)
* Google Gemini API Key

---

### 📥 Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/somu0571/InternPilot.git
   cd InternPilot
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Copy the template above into a `.env` file and supply your credentials.

4. **Run Skill-Proficiency Migration (Optional / Recommended):**
   ```bash
   npm run migrate:skill-proficiencies
   ```

5. **Start the application:**
   * Development with auto-reload:
     ```bash
     npx nodemon app.js
     ```
   * Production mode:
     ```bash
     node app.js
     ```

6. **Access the application:**
   Open your browser at `http://localhost:8080`.

---

## 🔌 Key Application Routes Overview

| Method | Endpoint | Description | Access |
| :--- | :--- | :--- | :--- |
| **GET** | `/register` | Multi-role registration page | Public |
| **POST** | `/verify-otp` | Verify 6-digit email OTP | Public |
| **GET / POST**| `/login` | User login (local strategy) | Public |
| **GET** | `/auth/google` | Google OAuth 2.0 Single Sign-On | Public |
| **GET** | `/candidate/profile` | Candidate profile, resume & skills | Candidate |
| **GET** | `/candidate/recommendations` | AI internship recommendations | Candidate |
| **POST** | `/candidate/resume` | Upload resume with AI quality check | Candidate |
| **POST** | `/chat` | AI recruiter interactive chatbot | Candidate |
| **GET** | `/interview/mock` | AI technical mock interview & problems | Candidate |
| **GET** | `/company/dashboard` | Recruiter dashboard & applicant review | Company |
| **POST** | `/company/internship` | Publish or draft internship listings | Company |
| **GET** | `/admin/dashboard` | Administrative analytics & moderation | Admin |
| **GET** | `/grievances` | Grievance redressal management | Auth Users |
| **GET** | `/certificates/verify/:id` | Public verification of certificate | Public |

---

## 🔄 Core Application Lifecycle Flow

```text
       Candidate Registration / Google OAuth
                         |
                         ↓
               Email OTP Verification
                         |
                         ↓
           Profile Completion & Resume Upload
       (AI ATS Quality Feedback + Conflict Resolution)
                         |
                         ↓
   ┌─────────────────────┴─────────────────────┐
   ↓                                           ↓
AI Recommendations & Search         AI Mock Interview & Chatbot
   │                                           │
   └─────────────────────┬─────────────────────┘
                         ↓
               Internship Application
                         ↓
      Company Reviews Application in ATS Pipeline
  (Under Review → Shortlisted → Interview → Offer)
                         ↓
           Atomic Offer Acceptance & Hiring
                         ↓
           Verified Certificate Issuance
```

---

## 🔮 Future Enhancements

* 🔔 Real-time WebSocket push notifications.
* 📱 Mobile responsive PWA (Progressive Web App).
* 📹 In-browser video interview integration.


## 🚀 START2CODE — Git, GitHub & Open Source Bootcamp

<p align="center">
  <b>LEARN • BUILD • CONTRIBUTE</b>
</p>

InternPilot is featured as part of **START2CODE — Git, GitHub & Open Source Bootcamp**, a hands-on initiative focused on helping beginners learn Git, GitHub, open-source workflows, and collaborative software development.

### 📅 Event Details

* 🗓️ **Dates:** 19–20 September 2026
* 💻 **Format:** Online Event
* 🎯 **Audience:** For Beginners
* ⏱️ **Duration:** 2-Day Hands-On Workshop + 1-Week Open Source Contribution Marathon

### 📚 Key Topics

* Learn Git & GitHub from scratch
* VS Code & Git Integration
* SSH Workflows
* Open Source Practices & Real-World Workflows
* Branching, Commits, Merging, & Pull Requests

### 💡 What Happens?

Participants get hands-on experience with:

* 🔧 Learning Git & GitHub from scratch.
* 💻 Practicing Git workflows using VS Code.
* 🐙 Exploring open-source projects and real-world workflows.
* 🤝 Contributing to real projects and earning recognition.
* 🔀 Understanding branches, commits, merges, and pull requests.
* 🌐 Learning how to collaborate effectively on GitHub.


START2CODE is an initiative event owned and organized by the **GitHub Club under Technova Society, SSCSE, Sharda University**, encouraging students to learn, build, collaborate, and contribute to real-world open-source projects.

<p align="center">
  <b>🚀 LEARN • BUILD • CONTRIBUTE 🚀</b>
</p>

---

## Contributors

<!-- readme: contributors-start -->
<table>
	<tbody>
		<tr>
            <td align="center">
                <a href="https://github.com/somu0571">
                    <img src="https://avatars.githubusercontent.com/u/218252841?v=4" width="100;" alt="somu0571"/>
                    <br />
                    <sub><b>SOMSUBHRA CHATTERJEE</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/huzaifa069HUZ">
                    <img src="https://avatars.githubusercontent.com/u/223731712?v=4" width="100;" alt="huzaifa069HUZ"/>
                <a href="https://github.com/rajeevsahani">
                    <img src="https://avatars.githubusercontent.com/u/10737960?v=4" width="100;" alt="rajeevsahani"/>
                    <br />
                    <sub><b>Rajeev Kumar</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/archlight20">
                    <img src="https://avatars.githubusercontent.com/u/120593356?v=4" width="100;" alt="archlight20"/>
                    <br />
                    <sub><b>archlight20</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/Tanmoysahacodes">
                    <img src="https://avatars.githubusercontent.com/u/132278570?v=4" width="100;" alt="Tanmoysahacodes"/>
                    <br />
                    <sub><b>TANMOY SAHA</b></sub>
                <a href="https://github.com/Dushyant-web">
                    <img src="https://avatars.githubusercontent.com/u/76154071?v=4" width="100;" alt="Dushyant-web"/>
                    <br />
                    <sub><b>Dushyant Prajapati</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/huzaifa069HUZ">
                    <img src="https://avatars.githubusercontent.com/u/223731712?v=4" width="100;" alt="huzaifa069HUZ"/>
                    <br />
                    <sub><b>Huzaifa Tabish</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/archlight20">
                    <img src="https://avatars.githubusercontent.com/u/120593356?v=4" width="100;" alt="archlight20"/>
                    <br />
                    <sub><b>archlight20</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/rajeevsahani">
                    <img src="https://avatars.githubusercontent.com/u/10737960?v=4" width="100;" alt="rajeevsahani"/>
                    <br />
                    <sub><b>Rajeev Kumar</b></sub>
                </a>
            </td>
		</tr>
		<tr>
            <td align="center">
                <a href="https://github.com/alisayam-786">
                    <img src="https://avatars.githubusercontent.com/u/233578022?v=4" width="100;" alt="alisayam-786"/>
                    <br />
                    <sub><b>Ali Sayam</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/rajjayant7">
                    <img src="https://avatars.githubusercontent.com/u/254138862?v=4" width="100;" alt="rajjayant7"/>
                    <br />
                    <sub><b>JAYANT RAJ</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/UTT-THE-CODER">
                    <img src="https://avatars.githubusercontent.com/u/255687562?v=4" width="100;" alt="UTT-THE-CODER"/>
                    <br />
                    <sub><b>Uttkarsh </b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/deepanshusahani15">
                    <img src="https://avatars.githubusercontent.com/u/285276346?v=4" width="100;" alt="deepanshusahani15"/>
                    <br />
                    <sub><b>Deepanshu Sahani</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/ChiragYadav2000">
                    <img src="https://avatars.githubusercontent.com/u/93484451?v=4" width="100;" alt="ChiragYadav2000"/>
                    <br />
                    <sub><b>ChiragYadav2000</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/vishnu-s-tripathi06">
                    <img src="https://avatars.githubusercontent.com/u/108225421?v=4" width="100;" alt="vishnu-s-tripathi06"/>
                    <br />
                    <sub><b>Vishnu Shankar Tripathi</b></sub>
                </a>
            </td>
		</tr>
		<tr>
            <td align="center">
                <a href="https://github.com/YaKoT77">
                    <img src="https://avatars.githubusercontent.com/u/210996344?v=4" width="100;" alt="YaKoT77"/>
                    <br />
                    <sub><b>Yash Kotnala</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/bhandarijiya28-sketch">
                    <img src="https://avatars.githubusercontent.com/u/331283845?v=4" width="100;" alt="bhandarijiya28-sketch"/>
                    <br />
                    <sub><b>bhandarijiya28-sketch</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/vaishnaviverma16112008-byte">
                    <img src="https://avatars.githubusercontent.com/u/324442031?v=4" width="100;" alt="vaishnaviverma16112008-byte"/>
                    <br />
                    <sub><b>vaishnaviverma16112008-byte</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/zaidindia1max">
                    <img src="https://avatars.githubusercontent.com/u/244500526?v=4" width="100;" alt="zaidindia1max"/>
                    <br />
                    <sub><b>zaidindia1max</b></sub>
                </a>
            </td>
		</tr>
	<tbody>
</table>
<!-- readme: contributors-end -->

## ⭐ Acknowledgement

This project represents our effort towards building a practical full-stack solution that improves internship discovery, application management, and communication between students and organizations.

⭐ **If you find InternPilot useful, consider giving the repository a star!**
