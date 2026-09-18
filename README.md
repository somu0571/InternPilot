# 🚀 InternPilot

<p align="center">
  <b>An AI-Powered Full-Stack Internship Management & Recruitment Portal</b>
</p>

<p align="center">
  Connecting students, companies, and administrators through a secure and efficient internship ecosystem.
</p>

<p align="center">

![Node.js](https://img.shields.io/badge/Node.js-v16%2B-green?logo=node.js)
![Express.js](https://img.shields.io/badge/Express.js-Backend-black?logo=express)
![MongoDB](https://img.shields.io/badge/MongoDB-Database-green?logo=mongodb)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-CSS-blue?logo=tailwindcss)

</p>

---

## 📌 About The Project

**InternPilot** is an AI - powered full-stack internship management web portal designed to connect **students/candidates** with **companies offering internship opportunities** while providing administrators with complete system control.

The platform provides a structured environment where:

* 🎓 **Candidates** can register, discover internship opportunities, apply, and track application progress.
* 🏢 **Companies** can create verified profiles, publish internship listings, and manage applicants.
* 🛡️ **Administrators** can monitor and manage platform activities securely.

InternPilot focuses on providing a secure authentication system, automated communication, and role-based access control to create a seamless internship experience.

This project was developed as part of **Project Based Learning - 1**.

---

## ✨ Features

### 👥 Multi-Role Registration System

InternPilot supports three different user roles:

#### 🎓 Candidates

* Create candidate accounts.
* Verify email through OTP.
* Login securely.
* Apply for internships.
* Receive application status updates.

#### 🏢 Companies

Companies can register by providing:

* Company Name
* CIN Number
* Industry Details
* Company Information

Companies can:

* Manage their profile.
* Publish internship opportunities.
* Review candidate applications.

#### 🛡️ Administrators

Admin registration is protected using a secure:

```env
ADMIN_SECRET
```

Administrators have access to system-level management features.

---

## 🔐 Authentication & Security

### 📩 OTP Email Verification

InternPilot implements secure email verification using dynamic OTP generation.

**Features:**

* 🔢 6-digit OTP generation.
* ⏳ OTP expiration after 10 minutes.
* 🔄 Resend OTP functionality.
* 📧 Email delivery using Nodemailer and Gmail SMTP.

---

### 🔵 Google OAuth 2.0

Users can authenticate using Google Single Sign-On.

**Benefits:**

* One-click registration.
* Secure OAuth authentication.
* Automatic email verification.
* Passport.js integration.

---

### 🔑 Role-Based Authentication

InternPilot uses role-based routing to provide different experiences for each user.

After successful authentication:

| Role | Dashboard |
| :--- | :--- |
| **Admin** | `/admin/dashboard` |
| **Company** | `/company/dashboard` |
| **Candidate** | `/` |

Users must complete email verification before accessing the platform.

---

## 📧 Application Status Notification System

InternPilot includes an automated email notification service.

Candidates receive emails whenever their application status changes:

| Status | Description |
| :--- | :--- |
| 📤 **Submitted** | Application successfully submitted |
| 🔍 **Under Review** | Company is reviewing application |
| ⭐ **Shortlisted** | Candidate selected for next step |
| ❌ **Rejected** | Application not selected |

**Powered by:**

* Nodemailer
* Gmail SMTP

---

## 🎨 Dynamic User Interface

The frontend provides a responsive and interactive experience.

**Implemented features:**

* Server-side rendering using EJS.
* Reusable layouts using `ejs-mate`.
* Tailwind CSS styling.
* Dynamic registration forms.
* Role-based input field toggling using JavaScript.

---

## 🛠️ Tech Stack

### Backend

| Technology | Purpose |
| :--- | :--- |
| **Node.js** | Runtime environment |
| **Express.js** | Backend framework |
| **MongoDB** | Database |
| **Mongoose** | MongoDB ODM |

---

### Authentication

| Technology | Purpose |
| :--- | :--- |
| **Passport.js** | Authentication middleware |
| **Passport Local Strategy** | Email/password login |
| **Passport Google OAuth 2.0** | Google authentication |
| **Express Session** | Session management |
| **Connect Flash** | Flash messages |

---

### Frontend

| Technology | Purpose |
| :--- | :--- |
| **EJS** | Server-side templates |
| **ejs-mate** | Layout management |
| **Tailwind CSS** | UI styling |
| **JavaScript** | Client-side interactions |

---

### Utilities

| Technology | Purpose |
| :--- | :--- |
| **Nodemailer** | Email services |
| **dotenv** | Environment variables |

---

## 📁 Directory Structure

```text
InternPilot/
│
├── models/
│   └── User.js
│       └── User schema for Candidates, Companies & Admins
│
├── routes/
│   │
│   ├── auth.js
│   │   └── Registration, Login, OTP, Google OAuth routes
│   │
│   ├── company.js
│   │   └── Company dashboard and internship management
│   │
│   └── admin.js
│       └── Admin dashboard routes
│
├── utils/
│   │
│   └── sendEmail.js
│       └── Nodemailer email service
│
├── views/
│   │
│   ├── auth/
│   │   ├── register.ejs
│   │   └── login.ejs
│   │
│   ├── extras/
│   │   └── verify-otp.ejs
│   │
│   └── layouts/
│       └── ejs-mate layouts
│
├── public/
│   └── Static assets
│
├── app.js
│   └── Main Express server
│
├── .env
├── package.json
└── README.md
```

---

## ⚙️ Environment Configuration

Copy the example configuration file to create your local `.env`:

```bash
cp .env.example .env
```

### 📄 Example Configuration (`.env`)

```env
# Server Configuration
PORT=8080
NODE_ENV=development

# MongoDB Configuration (REQUIRED)
ATLASDB_URL=mongodb+srv://username:password@cluster.mongodb.net/internpilot?retryWrites=true&w=majority

# Express Session & Security
SESSION_SECRET=your_session_secret
ADMIN_SECRET=your_admin_secret_key

# Gmail SMTP Configuration (Required for OTP & status emails)
EMAIL_SERVICE=gmail
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_gmail_app_password

# Google OAuth Configuration (Optional)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:8080/auth/google/callback

# Cloudinary Configuration (Optional - required for avatar & resume uploads)
CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret

# Google Gemini AI Configuration (Optional - required for AI chat)
GEMINI_API_KEY=your_gemini_api_key
```

### 📋 Environment Variables Reference

| Variable | Required | Default | Description & Failure Behavior |
| :--- | :---: | :--- | :--- |
| `ATLASDB_URL` | **Yes** | — | **Database Connection:** MongoDB Atlas connection URI. The server will fail to start and crash with a `MongooseError` if this variable is missing or invalid. |
| `PORT` | No | `8080` | **Server Port:** HTTP port number for Express. Defaults to `8080` if unspecified. |
| `NODE_ENV` | No | `development` | **Runtime Mode:** Application environment mode (`development` / `production`). Production hides verbose error stack traces from users. |
| `SESSION_SECRET` | No | `"supersecretkey"` | **Session Signing:** Key used by `express-session` to sign cookie sessions. A secure random string should be provided in production. |
| `ADMIN_SECRET` | No | `'SUPER_SECRET_ADMIN_KEY_123'` | **Admin Registration:** Passphrase required to register an account with the `Admin` role. |
| `EMAIL_USER` | **Yes\*** | — | **SMTP User:** Email address used by Nodemailer to dispatch OTP verification and status notifications. Email sending fails if missing. |
| `EMAIL_PASS` | **Yes\*** | — | **SMTP Password:** 16-character Gmail App Password. Nodemailer authentication fails if missing. |
| `EMAIL_SERVICE` | No | `'gmail'` | **Email Provider:** Nodemailer service provider name (defaults to `gmail`). |
| `GOOGLE_CLIENT_ID` | Optional | `'dummy_id'` | **Google OAuth:** OAuth 2.0 Client ID. Google sign-in redirects to an error if dummy or missing. |
| `GOOGLE_CLIENT_SECRET` | Optional | `'dummy_secret'` | **Google OAuth:** OAuth 2.0 Client Secret. Token exchange fails if invalid. |
| `GOOGLE_CALLBACK_URL` | No | `http://localhost:8080/auth/google/callback` | **Google OAuth:** Authorized redirect URI for Google OAuth callbacks. |
| `CLOUDINARY_CLOUD_NAME` | Optional | — | **Media Storage:** Cloudinary cloud account name for avatar and resume uploads. Upload routes throw an error if missing. |
| `CLOUDINARY_API_KEY` | Optional | — | **Media Storage:** Cloudinary API key for file upload authorization. |
| `CLOUDINARY_API_SECRET` | Optional | — | **Media Storage:** Cloudinary API secret for file upload authorization. |
| `GEMINI_API_KEY` | Optional | — | **AI Assistant:** Google Gemini API key used by the `@google/genai` assistant in `/chat`. AI chat responses fail if missing. |

*\* Required for user registration OTP verification and applicant status email notifications.*

---

## 🚀 Getting Started

### ✅ Prerequisites

Make sure you have installed:

* [Node.js](https://nodejs.org/)
* `npm` package manager
* MongoDB database (Local or MongoDB Atlas)
* Git

Check versions:

```bash
node -v
npm -v
```

---

## 📥 Installation

### 1. Clone Repository

```bash
git clone https://github.com/somu0571/InternPilot.git
```

Navigate into project directory:

```bash
cd InternPilot
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Copy the environment template to create your `.env` file:

```bash
cp .env.example .env
```

Fill in your MongoDB Atlas connection string (`ATLASDB_URL`), session secrets, and optional API keys (see [Environment Configuration](#-environment-configuration) table above for details).

### 4. Start Application

Development mode:

```bash
npx nodemon app.js
```

or standard start:

```bash
node app.js
```

### 5. Access Application

Open your browser and navigate to:

```text
http://localhost:8080
```

---

## 🔌 API & Authentication Routes Overview

### Authentication Routes

| Method | Route | Description |
| :--- | :--- | :--- |
| **GET** | `/register` | Registration page |
| **POST** | `/register` | Create user account |
| **POST** | `/verify-otp` | Verify email OTP |
| **POST** | `/resend-otp` | Generate new OTP |
| **GET** | `/login` | Login page |
| **POST** | `/login` | Authenticate user |
| **GET** | `/auth/google` | Google OAuth login |
| **GET** | `/auth/google/callback` | OAuth callback |
| **GET** | `/logout` | Logout user |

---

### Company Routes

| Method | Route | Description |
| :--- | :--- | :--- |
| **GET** | `/company/dashboard` | Company dashboard |
| **POST** | `/company/internship` | Create internship listing |
| **GET** | `/company/applications` | View applications |

---

### Admin Routes

| Method | Route | Description |
| :--- | :--- | :--- |
| **GET** | `/admin/dashboard` | Admin dashboard |
| **GET** | `/admin/users` | Manage users |

---

## 🔄 Application Flow

```text
User Registration
        |
        ↓
Role Selection
        |
        ↓
Email OTP Verification
        |
        ↓
Account Activated
        |
        ↓
Role-Based Dashboard
        |
        ↓
Internship Management
        |
        ↓
Application Updates + Email Notifications
```

---

## 🔮 Future Enhancements

Planned improvements:

* 🤖 AI-based internship recommendation engine.
* 🔔 Push notifications.


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

## ⭐ Acknowledgement

This project represents our effort towards building a practical full-stack solution that improves internship discovery, application management, and communication between students and organizations.

⭐ **If you find InternPilot useful, consider giving the repository a star!**