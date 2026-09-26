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
* Set each listed skill to **Beginner**, **Intermediate**, or **Advanced** so matching reflects current proficiency.

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

Create a `.env` file in the root directory.

```env
# Server Configuration
PORT=8080

# MongoDB Configuration
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/internpilot

# Express Session
SESSION_SECRET=your_session_secret

# Admin Security
ADMIN_SECRET=your_admin_secret_key

# Gmail SMTP Configuration
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_gmail_app_password

# Google OAuth Configuration
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:8080/auth/google/callback
```

---

## 🚀 Getting Started

### Skill-proficiency data migration

Existing candidate skill tags remain supported and are treated as **Intermediate** until they are edited. After deploying this feature, backfill the structured proficiency field once with:

```bash
npm run migrate:skill-proficiencies
```

The script only updates candidate profiles and clears their cached recommendations so new proficiency-aware rankings can be generated.

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

Create `.env` file and add required credentials as shown in the Environment Configuration section.

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
                <a href="https://github.com/archlight20">
                    <img src="https://avatars.githubusercontent.com/u/120593356?v=4" width="100;" alt="archlight20"/>
                    <br />
                    <sub><b>archlight20</b></sub>
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
                <a href="https://github.com/Tanmoysahacodes">
                    <img src="https://avatars.githubusercontent.com/u/132278570?v=4" width="100;" alt="Tanmoysahacodes"/>
                    <br />
                    <sub><b>TANMOY SAHA</b></sub>
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
                <a href="https://github.com/alisayam-786">
                    <img src="https://avatars.githubusercontent.com/u/233578022?v=4" width="100;" alt="alisayam-786"/>
                    <br />
                    <sub><b>Ali Sayam</b></sub>
                </a>
            </td>
		</tr>
		<tr>
            <td align="center">
                <a href="https://github.com/rajeevsahani">
                    <img src="https://avatars.githubusercontent.com/u/10737960?v=4" width="100;" alt="rajeevsahani"/>
                    <br />
                    <sub><b>Rajeev Kumar</b></sub>
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
