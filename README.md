# 🚀 InternPilot

<p align="center">
  <b>An AI-Powered Full-Stack Internship Management & Recruitment Portal</b>
  <br />
  <i>Connecting students, enterprise recruiters, and administrators through a secure, intelligent, and scalable internship ecosystem.</i>
</p>

<p align="center">
  <img src="public/images/internpilot-logo.svg" alt="InternPilot Logo" width="90" height="90" />
</p>

<p align="center">
  <a href="#-project-based-learning---1-pbl---1"><img src="https://img.shields.io/badge/Project-PBL--1%20Capstone-blueviolet?style=for-the-badge&logo=codeforces" alt="PBL-1" /></a>
  <a href="#-tech-stack"><img src="https://img.shields.io/badge/Node.js-v18%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" /></a>
  <a href="#-tech-stack"><img src="https://img.shields.io/badge/Express.js-Backend-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express.js" /></a>
  <a href="#-tech-stack"><img src="https://img.shields.io/badge/MongoDB-Atlas-47A248?style=for-the-badge&logo=mongodb&logoColor=white" alt="MongoDB" /></a>
  <a href="#-tech-stack"><img src="https://img.shields.io/badge/Google%20Gemini-AI%20Powered-4285F4?style=for-the-badge&logo=google&logoColor=white" alt="Google Gemini" /></a>
  <a href="#-tech-stack"><img src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="Tailwind CSS" /></a>
  <a href="#-tech-stack"><img src="https://img.shields.io/badge/Cloudinary-Media-3448C5?style=for-the-badge&logo=cloudinary&logoColor=white" alt="Cloudinary" /></a>
</p>

---

## 🎓 Project-Based Learning - 1 (PBL - 1)

This project has been researched, architected, and developed as a comprehensive capstone for **Project-Based Learning - 1 (PBL - 1)**. 

The objective of **PBL - 1** is to design and build an industry-grade, end-to-end full-stack software application that tackles real-world hiring bottlenecks, bridges student-industry opportunity gaps, and incorporates cutting-edge Artificial Intelligence capabilities, strong security paradigms, and clean architectural patterns.

### 👥 Team Members

| Name | Role & Core Contributions | GitHub Profile |
| :--- | :--- | :--- |
| **Somsubhra Chatterjee** | **Full-Stack Architecture & Lead Developer**<br>• System Architecture & Database Design (MongoDB/Mongoose)<br>• Google Gemini AI Integration & Recommendation Engine<br>• Role-Based Access Control (RBAC), Auth & Security Engines | [@somu0571](https://github.com/somu0571) |
| **Avani Shrivastava** | **Full-Stack Development & Product Workflow**<br>• Candidate & Recruiter Portal Workflows<br>• Application Tracking System (ATS) Pipeline & Review Flows<br>• UI/UX Implementation & Responsive Design Systems | [@Avani176](https://github.com/Avani176) |
| **Tanmoy Saha** | **Full-Stack Development & Platform Modules**<br>• Grievance Redressal System & Verification Engines<br>• Resume Parsing & Conflict Resolution Engines<br>• Testing, API Integration & Documentation | [@Tanmoysahacodes](https://github.com/Tanmoysahacodes) |

---

## 📌 Project Overview

**InternPilot** is a production-grade, AI-powered internship discovery and applicant management ecosystem tailored to modern hiring requirements. Built with national initiatives such as the **PMIS (Prime Minister's Internship Scheme)** in mind, InternPilot streamlines the end-to-end internship lifecycle for three primary user personas:

1. **🎓 Candidates / Students:** Discover AI-matched internship opportunities, receive automated ATS resume feedback, take AI-generated role-specific mock interviews, verify PMIS scheme eligibility, apply seamlessly with customized screening answers, track application milestones in real-time, communicate directly with recruiters, and earn cryptographically verifiable digital certificates.
2. **🏢 Companies / Recruiters:** Complete business verification (CIN), publish and manage flexible internship postings (active, paused, drafted), review incoming applicants in an interactive ATS Kanban/Pipeline view, conduct messaging and schedule interviews, manage seat capacity limits atomically, and collect candidate reviews.
3. **🛡️ Administrators & Governance:** Oversee platform analytics, moderate companies and listings, resolve grievance tickets filed by candidates or employers, publish systemwide announcements, and audit all critical platform events.

---

## 🌟 Key Features

### 🤖 1. Advanced Google Gemini AI Suite
* **📄 AI Resume ATS Quality Analyzer:** Automatically scans uploaded candidate resumes to provide constructive, non-numeric diagnostic feedback evaluating technical skill density, project relevance, quantifiable business achievements, and formatting clarity.
* **🎯 Semantic Match & Recommendation Engine:** Features a multi-stage funnel:
  1. *Rule-based pre-filter:* Matches location preferences, required proficiencies, and eligibility criteria.
  2. *Privacy Filter:* Strips personally identifiable information (PII) before LLM ingestion.
  3. *Semantic Evaluation:* Leverages Google Gemini embeddings to compute relevance scores and generate personalized skill-gap advisories.
  4. *Deterministic Fallback:* Ensures recommendations remain available even during external network throttling.
* **💬 Conversational Recruiter AI Chatbot:** In-app real-time conversational assistant helping candidates query available internships, understand role requirements, and navigate application procedures.
* **🎙️ AI Mock Interview & Technical Question Generator:** Dynamically creates tailored mock technical questions, behavioral prompts, and coding challenges matched specifically to the applicant's resume and target job profile.
* **🛡️ Multi-Tier Model Resilience:** Automatic failover cascade (`gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-1.5-flash`) guaranteeing zero platform disruption during upstream API latency.

---

### 🎓 2. Candidate Portal
* **👤 Comprehensive Profiles & Skill Proficiencies:** Define granular skill levels (**Beginner**, **Intermediate**, **Advanced**) for high-precision algorithmic matching.
* **🇮🇳 PMIS Eligibility Verification:** Built-in evaluation engine assessing age, educational qualification, income, and background against official scheme parameters.
* **📥 Multi-Format Resume Parser & Conflict Resolution:** Extracts profile attributes directly from PDF and DOCX files (`pdf-parse`, `mammoth`), with an interactive side-by-side reconciliation modal to confirm extracted data.
* **📜 Resume Version Control:** Upload, organize, and inspect multiple historical resume snapshots securely stored on Cloudinary.
* **💼 Real-Time Application Tracking:** Live visual status progression through each phase: `Submitted` ➔ `Under Review` ➔ `Shortlisted` ➔ `Interview Scheduled` ➔ `Offer Extended` ➔ `Hired` / `Rejected`.
* **💬 Recruiter Direct Messaging:** Integrated real-time messaging channel to connect directly with hiring managers.
* **🏆 Verifiable Digital Certificates:** Issue and download tampering-resistant PDF internship completion certificates equipped with unique verification IDs and scannable QR codes.
* **🔐 Active Session & Device Manager:** Inspect active device logins, masked IP geolocation, and remotely revoke untrusted sessions.

---

### 🏢 3. Enterprise & Recruiter Portal
* **🏢 Verified Company Profiles:** Corporate identification number (CIN) check and profile verification badges for recruiter trust.
* **📋 Internship Lifecycle Management:** Create, save as draft, publish, pause, duplicate, or close internship listings with custom application deadlines and stipends.
* **👥 Full Applicant Tracking System (ATS):** Multi-stage hiring funnel allows recruiters to filter applicants, view matched scores, review custom screening answers, download resumes, schedule interviews, and extend offers.
* **❓ Custom Screening Questions:** Attach mandatory or optional custom text questions with defined character limits to filter applicants effectively.
* **🛑 Atomic Capacity Management:** Real-time database-level concurrency controls that prevent over-hiring beyond advertised vacancy quotas.
* **⭐ Feedback & Reputation:** Display verified candidate reviews and transparent ratings.

---

### 🛡️ 4. Administration & Governance Console
* **📊 Visual Platform Analytics:** Interactive metrics on active internships, candidate demographic distribution, application conversion rates, and company activity.
* **🛡️ Listing & Profile Moderation:** Review and flag low-quality or non-compliant job listings and company profiles.
* **📑 Grievance Redressal System:** Multi-tier support ticketing system allowing users to report disputes, monitor status updates, and receive official administrative resolutions.
* **📢 Broadcast Announcements:** Post platform updates, maintenance notices, and government scheme notifications directly to user dashboards.
* **🔒 Comprehensive Audit Logs:** Immutable recording of privileged admin actions for complete accountability.

---

### 🔐 5. Security & Authentication Architecture
* **📩 6-Digit Email OTP Verification:** Secure two-step email validation using Nodemailer and Gmail SMTP with 10-minute validity and resend cooldown guards.
* **🌐 Google OAuth 2.0 Integration:** Frictionless single-sign-on (SSO) using Passport.js with automatic email verification.
* **🔑 Role-Based Access Control (RBAC):** Strict middleware guards separating routes for Candidate, Company, and Admin privileges.
* **🛡️ Hardened Session Security:** HTTP-only cookies, MongoDB session persistence, Bcrypt password hashing, and CSRF prevention patterns.
* **☁️ Cloudinary Secure Media Delivery:** Signed and authenticated cloud uploads for resumes and company collateral.

---

## 🔄 System Architecture & Data Flow

```text
                                 ┌────────────────────────────────────────────────┐
                                 │                   INTERNPILOT                  │
                                 │              PBL - 1 Architecture              │
                                 └────────────────────────────────────────────────┘

         [ Candidate ]                    [ Company / Recruiter ]                 [ Administrator ]
               │                                     │                                    │
               │ (Register / Google OAuth)           │ (Register / Verification)          │ (Admin Login)
               ▼                                     ▼                                    ▼
      ┌───────────────────────────────────────────────────────────────────────────────────────────┐
      │                                   EXPRESS.JS BACKEND                                      │
      │                       Authentication (Passport.js) & Role Guards                          │
      └───────────────────────────────────────────────────────────────────────────────────────────┘
               │                                     │                                    │
       ┌───────┴────────┐                    ┌───────┴────────┐                   ┌───────┴────────┐
       ▼                ▼                    ▼                ▼                   ▼                ▼
   [ Profile &      [ AI Mock            [ Job Postings    [ ATS Kanban       [ Grievances     [ Audit Logs &
   Resume Parser ]   Interview ]          & Capacity ]      Pipeline ]         & Moderation ]   Analytics ]
       │                │                    │                │                   │                │
       ▼                ▼                    ▼                ▼                   ▼                ▼
  ┌─────────┐     ┌──────────────┐      ┌─────────┐      ┌──────────┐        ┌─────────┐      ┌─────────┐
  │Cloudinar│     │Google Gemini │      │ MongoDB │      │  Email   │        │ MongoDB │      │ Admin   │
  │ Resume  │     │   AI Engine  │      │ Models  │      │ Services │        │ Models  │      │ Console │
  └─────────┘     └──────────────┘      └─────────┘      └──────────┘        └─────────┘      └─────────┘
```

---

## 🛠️ Tech Stack

### Backend & Middleware
| Technology | Description |
| :--- | :--- |
| **Node.js** | High-performance asynchronous JavaScript server runtime |
| **Express.js (v5)** | Modular routing and backend web server framework |
| **MongoDB & Mongoose** | Flexible document database with schema validation and atomic operations |
| **Passport.js** | Multi-strategy authentication (Local & Google OAuth 2.0) |
| **Nodemailer** | Transactional email transmission for 6-digit OTPs and notifications |
| **Bcrypt.js** | Salted cryptographic password hashing |
| **Multer & Cloudinary** | Multi-part form parsing with signed cloud storage |
| **PDFKit & QRCode** | Programmatic PDF certificate rendering and QR verification |
| **pdf-parse & Mammoth** | Automated text and metadata extraction from PDF and Word resumes |

### Artificial Intelligence
| Technology | Description |
| :--- | :--- |
| **Google GenAI SDK (`@google/genai`)** | Official Google Gemini API client |
| **Gemini 2.5 Flash** | Primary LLM engine for resume diagnostics and semantic recommendations |
| **Gemini 2.0 / 1.5 Flash** | Built-in fallback cascade models for resilience |

### Frontend & UI
| Technology | Description |
| :--- | :--- |
| **EJS & ejs-mate** | Modular server-rendered layouts, partials, and view templates |
| **Tailwind CSS** | Modern utility-first CSS design system |
| **Phosphor Icons** | Vector iconography |
| **Vanilla JavaScript** | Clean, fast client-side interactivity without bloated framework bundles |

---

## 📁 Directory Structure

```text
InternPilot/
├── config/                 # Service configurations
│   ├── cloudinary.js       # Cloudinary storage setup & credentials
│   └── passport.js         # Local and Google OAuth 2.0 strategies
├── models/                 # Mongoose schemas & data models
│   ├── User.js             # User accounts, skills, roles & session data
│   ├── Internship.js       # Internship listings, requirements & capacity
│   ├── Application.js      # Applicant submissions, status & custom answers
│   ├── Grievance.js        # Support & dispute resolution tickets
│   ├── Review.js           # Company ratings and feedback
│   └── Certificate.js      # Issued internship credentials
├── routes/                 # Express route handlers
│   ├── auth.js             # Authentication, OTP verification & OAuth callbacks
│   ├── candidate.js        # Candidate dashboards, profile, resume & applications
│   ├── company.js          # Recruiter management, ATS, listings & hiring
│   ├── adminConsole.js     # Admin oversight, analytics, and moderation
│   ├── chat.js             # AI Recruiter conversational chatbot
│   ├── interview.js        # AI Mock interview & problem generation
│   ├── grievances.js       # Grievance ticketing & resolution
│   ├── reviews.js          # Company reviews & feedback submission
│   └── certificates.js     # Public certificate verification & PDF rendering
├── utils/                  # Core algorithmic utilities
│   ├── aiClient.js         # Gemini API client with fallback cascade
│   ├── recommendationEngine.js # Multi-stage AI match recommendation pipeline
│   ├── pmisEligibility.js  # PMIS criteria validation logic
│   ├── candidateMatcher.js # Deterministic fallback scoring algorithm
│   └── sendEmail.js        # Nodemailer dispatch wrapper
├── views/                  # EJS templates
│   ├── auth/               # Login, register, OTP verification & password reset
│   ├── candidate/          # Candidate views (profile, recommendations, tracker)
│   ├── company/            # Recruiter views (dashboard, applicant review, listings)
│   ├── admin-console/      # Administrative analytics, grievances & logs
│   ├── messages/           # Direct candidate-recruiter messaging views
│   ├── partials/           # Reusable header, footer, modals, and navbars
│   └── layouts/            # ejs-mate layout wrappers
├── public/                 # Static assets (custom CSS, JS, brand logos, SVGs)
├── test/                   # Node.js test suites
├── app.js                  # Application server entrypoint
├── package.json            # Project manifest & dependency configuration
└── README.md               # Project documentation
```

---

## ⚙️ Environment Configuration

Create a `.env` file in the root directory with the following variables:

```env
# ==========================================
# SERVER CONFIGURATION
# ==========================================
PORT=8080
NODE_ENV=development

# ==========================================
# DATABASE (MongoDB Atlas or Local Replica)
# ==========================================
ATLASDB_URL=mongodb+srv://<username>:<password>@cluster.mongodb.net/internpilot?retryWrites=true&w=majority

# ==========================================
# AUTHENTICATION & SECRETS
# ==========================================
SESSION_SECRET=your_super_secret_session_key
ADMIN_SECRET=your_super_secret_admin_registration_key
ADMIN_CODE=your_super_secret_admin_registration_key

# ==========================================
# GMAIL SMTP CONFIGURATION (For OTP Emails)
# ==========================================
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_16_digit_gmail_app_password

# ==========================================
# GOOGLE OAUTH 2.0 CREDENTIALS
# ==========================================
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
GOOGLE_CALLBACK_URL=http://localhost:8080/auth/google/callback

# ==========================================
# CLOUDINARY RESUME & ASSET STORAGE
# ==========================================
CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret

# ==========================================
# GOOGLE GEMINI AI CONFIGURATION
# ==========================================
GEMINI_API_KEY=your_google_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
GEMINI_FALLBACK_MODEL=gemini-2.0-flash
RECOMMENDATION_AI_POOL_SIZE=25
```

---

## 🚀 Getting Started

### Prerequisites
* **Node.js**: v18.0.0 or higher
* **npm**: v9.0.0 or higher
* **MongoDB**: Atlas connection URI or local MongoDB instance with replica set support
* **Google Gemini API Key**: Obtainable from [Google AI Studio](https://aistudio.google.com/)

---

### Step-by-Step Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/somu0571/InternPilot.git
   cd InternPilot
   ```

2. **Install project dependencies:**
   ```bash
   npm install
   ```

3. **Set up Environment Variables:**
   ```bash
   cp .env.example .env   # Or create .env manually and populate with your credentials
   ```

4. **Run Database Migrations (Skill Proficiencies):**
   ```bash
   npm run migrate:skill-proficiencies
   ```

5. **Start the application:**
   * **Development Mode (with auto-reload):**
     ```bash
     npx nodemon app.js
     ```
   * **Production Mode:**
     ```bash
     npm start
     ```

6. **Open in Browser:**
   Navigate to [http://localhost:8080](http://localhost:8080) to explore the portal.

---

## 🔌 Key Application Endpoints

| Method | Route | Description | Access |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Portal landing page & feature showcase | Public |
| `GET` / `POST` | `/register` | Multi-role account registration | Public |
| `POST` | `/verify-otp` | Validate 6-digit email OTP | Public |
| `GET` / `POST` | `/login` | User login (Session/Local) | Public |
| `GET` | `/auth/google` | Google OAuth 2.0 single sign-on | Public |
| `GET` | `/candidate/profile` | Candidate profile, skill proficiencies & resume | Candidate |
| `POST` | `/candidate/resume` | Upload resume with automated AI ATS feedback | Candidate |
| `GET` | `/candidate/recommendations` | AI-powered personalized internship matches | Candidate |
| `POST` | `/chat` | Interactive AI recruiter conversational endpoint | Candidate |
| `GET` | `/interview/mock` | AI technical interview & problem generator | Candidate |
| `GET` | `/company/dashboard` | Recruiter overview & active listings | Company |
| `POST` | `/company/internship` | Publish or draft a new internship posting | Company |
| `GET` | `/company/applications/:id` | Review applicants in ATS pipeline | Company |
| `GET` | `/admin/dashboard` | High-level system metrics & analytics | Administrator |
| `GET` / `POST` | `/grievances` | Grievance redressal ticket submission & resolution | Authenticated |
| `GET` | `/certificates/verify/:id` | Public digital certificate verification | Public |

---

## 🚀 START2CODE Open Source Initiative

InternPilot was proudly showcased as part of **START2CODE — Git, GitHub & Open Source Bootcamp**, organized by the **GitHub Club under Technova Society, Department of Computer Science & Engineering, Sharda University**. The initiative empowered beginner developers to collaborate, contribute pull requests, and experience production open-source software engineering.

### 🤝 Community Contributors

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
            <td align="center">
                <a href="https://github.com/Dushyant-web">
                    <img src="https://avatars.githubusercontent.com/u/76154071?v=4" width="100;" alt="Dushyant-web"/>
                    <br />
                    <sub><b>Dushyant Prajapati</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/Tanmoysahacodes">
                    <img src="https://avatars.githubusercontent.com/u/132278570?v=4" width="100;" alt="Tanmoysahacodes"/>
                    <br />
                    <sub><b>TANMOY SAHA</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/huzaifa069HUZ">
                    <img src="https://avatars.githubusercontent.com/u/223731712?v=4" width="100;" alt="huzaifa069HUZ"/>
                    <br />
                    <sub><b>Huzaifa Tabish</b></sub>
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
                    <sub><b>Jayant Raj</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/UTT-THE-CODER">
                    <img src="https://avatars.githubusercontent.com/u/255687562?v=4" width="100;" alt="UTT-THE-CODER"/>
                    <br />
                    <sub><b>Uttkarsh</b></sub>
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
                    <sub><b>Chirag Yadav</b></sub>
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

---

## 📄 License

This project is licensed under the [ISC License](LICENSE).

---

<p align="center">
  <b>Built with ❤️ as part of Project-Based Learning - 1 (PBL - 1)</b>
  <br>
  <i>⭐ If you found InternPilot insightful, please consider starring the repository!</i>
</p>
