# SportSpot — Cricksal-First Player Matchmaking and Court Booking Platform

## Project Owner
Deepak Shrestha

## Project Name
SportSpot

## Current MVP Focus
SportSpot is currently focused ONLY on CRICKSAL.

Do not implement Futsal in the current MVP.
Do not add Futsal UI, Futsal routes, Futsal fields, Futsal roles, Futsal pages, or Futsal filters right now.

Futsal can be mentioned as future scope, but all current development should focus on Cricksal only.

Current tagline:
Find Courts. Join Games. Challenge Teams. Play with Trust.

---

# 1. Project Overview

SportSpot is a Nepal-focused sports coordination platform for Cricksal players.

The main purpose of SportSpot is not only court booking. The system should help Cricksal players:

- Find Cricksal courts
- Join open games
- Create or join teams
- Challenge other teams
- Manage confirmed matches through Game Room
- Build trust using rating and reliability
- Reduce manual confusion in court booking
- Help solo or unconnected players find games easily

SportSpot should be treated as a sports matchmaking and coordination platform, not just a booking website.

---

# 2. Current Technology Stack

Frontend:
- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui if already installed or useful
- Responsive UI

Backend:
- Django
- Django REST Framework
- JWT authentication using SimpleJWT
- PostgreSQL database

Architecture:
- Decoupled frontend and backend
- Next.js handles frontend UI and routing
- Django REST Framework handles backend APIs and business logic
- PostgreSQL stores relational data

---

# 3. Development Style Rules for Codex

Before making changes:
- Read this README carefully.
- Inspect the current project structure.
- Understand what is already implemented.
- Do not rewrite the whole project unnecessarily.
- Do not break working login/register.
- Do not create future modules early.
- Implement only the phase requested.
- Explain all files changed after implementation.
- Provide exact commands to run.
- Provide testing checklist after each phase.

Important:
This project is being developed step by step. Do not jump ahead.

---

# 4. Current Completed Work

Phase 1 is completed:
- Project setup exists.
- Backend Django project exists.
- Frontend Next.js project exists.
- PostgreSQL is connected.
- Authentication works.
- Player registration works.
- Login works.
- JWT/token authentication works.
- Role-based dashboard redirect exists or should be preserved.
- Basic navigation/dashboard shell may already exist.

Do not break Phase 1.

---

# 5. Current Main Development Direction

Current implementation focus includes:
- Player authentication and Cricksal profile
- Cricksal team management
- Real notification center for active events
- Cricksal court owner venue setup
- Admin venue verification
- Player court discovery and booking

Do not focus on:
- Futsal
- Production payment settlement
- Challenge Teams booking integration
- Game Room
- Advanced AI
- Full scoring system
- Advanced analytics

Build the system phase by phase and keep each completed phase working before adding the next one.

---

# 6. Sport Rule

Current sport focus:
- CRICKSAL only

Player profile should not ask:
- Preferred Sport
- Futsal Role
- Futsal Skill Level

Because the current platform flow has only Cricksal.

The player is automatically a Cricksal player.

Use Cricksal-related fields only.

Future scope:
- Futsal support can be added later using a sport preference model.
- For now, keep database and UI simple.

---

# 7. User Roles

The system supports:

1. PLAYER
2. COURT_OWNER
3. ADMIN

Current implemented role scope:
- PLAYER: profile, teams, invitations, court discovery, bookings
- COURT_OWNER: venue setup, court setup, slots, bookings, calendar
- ADMIN: venue approval, request changes, rejection, suspension

---

# 8. Navigation Rules

## Before Login

Navbar should show:

SportSpot | Courts | Find Game | Challenge Teams | Register Venue | Login | Sign Up

Since current MVP is Cricksal-only, do not use Courts dropdown with Cricksal/Futsal.

Use:

- Courts
- Find Game
- Challenge Teams
- Register Venue
- Login
- Sign Up

Register Venue appears only before login.

---

## After PLAYER Login

Navbar should show:

SportSpot | Courts | Find Game | Challenge Teams | Bell Icon | Player Name Dropdown

Do not show Register Venue after player login.

Player profile dropdown should contain only:

- Dashboard → /dashboard/player
- My Profile → /dashboard/player/profile
- Logout

Do not put Notifications inside profile dropdown.
Do not put Notifications inside dashboard sidebar.

---

# 9. Notification UX Rule

Notifications should be handled only through the navbar bell icon.

When the player clicks the bell icon:
- Open a Notification Center panel/drawer.
- On desktop, it can open as a right-side drawer.
- On mobile, it can open as a full-screen panel.

Notifications are backend-backed and created through one central notification service.
Do not use placeholder/static notification data for active features.

Notification state:
- Unseen means the notification card has not been visible in the Notification Centre for about one second.
- The bell badge counts unseen notifications.
- Read means the user opened the related page or completed an action.
- Opening the bell must not mark every notification read or seen.

Current connected events:
- Team invitations, invitation acceptance/rejection, invitation cancellation, and registered member removal
- Venue submission, approval, changes requested, rejection, and suspension
- Booking reservation, confirmation, payment failure/expiry, and cancellation
- Owner-managed mock refund requests and refund outcomes
- Important booking messages sent by a court owner to the player on that booking

Current delivery uses polling and refresh-on-focus. WebSocket infrastructure is future scope.

Challenge, join request, Game Room, match reminder, rating reminder, and dispute notification
types are reserved for their future modules. They must not display fake notifications or broken
actions until those modules exist.

Notification Center is an action center and should always use real database notifications.

---

# 10. Player Dashboard Structure

Player dashboard route:

/dashboard/player

Dashboard sidebar should contain:

- Overview
- My Profile
- My Teams
- My Matches / Game Rooms
- My Bookings
- My Requests
- My Invitations
- My Ratings
- Settings

Do not include Notifications in the dashboard sidebar.

Dashboard overview should show:

- Welcome message
- Profile status
- SportSpot ID
- Cricksal role
- Skill level
- Location
- Reliability display
- Completed matches
- No-shows
- Average rating
- Upcoming match placeholder
- Pending requests placeholder
- Team invitations placeholder

Quick action cards:

- Complete/Edit Profile
- Find Game
- Book Court
- Create Team
- Challenge Team

Only Complete/Edit Profile needs to fully work in Phase 2.
Other quick actions can remain placeholders for now.

---

# 11. Phase Plan

## Phase 1: Authentication
Status: Completed

Includes:
- Register
- Login
- JWT authentication
- Role-based redirect
- Basic dashboard route

---

## Phase 2: Player Profile and Cricksal Identity
Status: Completed

Goal:
A player should have a proper Cricksal sports identity after login.

Flow:
Player registers
→ account is created
→ PlayerProfile is created automatically
→ player logs in
→ dashboard shows profile status
→ player clicks Complete/Edit Profile
→ profile form opens with registration values already filled
→ player completes Cricksal details
→ profile is saved in PostgreSQL
→ dashboard updates profile status

---

## Phase 3: Team Management
Status: Completed

Includes:
- Create Cricksal team
- Captain role
- Invite registered players by SportSpot ID
- Registered player invitation accept/reject flow
- Add guest players
- Team profile
- Team reliability/rating placeholders

Registered player recruitment must use SportSpot ID only. Do not add email invite, phone invite, name search, or Futsal.

---

## Phase 4: Full Cricksal Court Booking
Status: Completed

Includes:
- Court owner venue setup
- Venue proof and verification submission
- Admin approval, request changes, rejection, and suspension
- Court setup
- Slot generation and pricing
- Player court discovery
- Slot reservation
- Khalti sandbox payment
- Mock payment fallback for local demo/testing
- Booking confirmation
- Booking pass
- Player booking history
- Court owner booking management
- Owner slot calendar with block/unblock
- Structured cancellation and refund policy
- Booking-time policy snapshots so later venue edits do not alter existing bookings
- Full, partial, and no-refund cancellation windows
- Owner-managed mock refund processing
- Automatic unpaid reservation expiry command

### Cancellation and Refund Operations

Each venue defines an executable cancellation policy. The default policy is:

- 100% refund when the player cancels at least 24 hours before the booking starts.
- 50% refund when the player cancels between 12 and 24 hours before the booking starts.
- No refund when the player cancels less than 12 hours before the booking starts.
- A venue-caused cancellation of a paid booking always requires a 100% refund.
- Cancelling an unpaid reservation releases all selected slots and requires no refund.
- Multi-slot bookings are cancelled atomically; every slot receives the same lifecycle outcome.
- Completed or already-started bookings cannot be cancelled through the normal player/owner flow.

Court owners may configure the full-refund cutoff, optional partial-refund window, and partial-refund percentage. SportSpot captures a versioned snapshot when a booking is reserved. A later policy edit applies only to future bookings.

Refund eligibility and amount are calculated by SportSpot. Khalti sandbox is used for demo payment confirmation, but refund settlement is still recorded manually by the venue owner in the MVP; the owner cannot reject or reduce a system-approved entitlement. Real payment-provider refund automation and dispute handling remain future scope.

### Reservation Expiry Operations

Unpaid reservations are held for 10 minutes. If the player does not complete Khalti sandbox payment or demo fallback payment before `reserved_until`, SportSpot expires the booking, marks payment as failed, releases all selected slots, and notifies the player and venue owner.

Run this command periodically:

```bash
cd backend
python manage.py expire_reservations
```

For a real deployment, schedule it every minute with Windows Task Scheduler, cron, or a worker process. The command is idempotent, so rerunning it does not duplicate payment-failed notifications or emails.

Confirmed paid bookings are completed after the final selected slot end time passes. Slots remain `BOOKED` for history, payment remains `PAID`, and the booking receives `completed_at`.

Run this command periodically:

```bash
cd backend
python manage.py complete_bookings
```

For a real deployment, schedule it every 5-15 minutes or hourly. Booking list/detail APIs also refresh lifecycle state when opened, so the UI corrects stale confirmed bookings even before the scheduler runs.

Recommended single maintenance command for local demo:

```bash
cd backend
python manage.py run_booking_maintenance
```

This runs reservation expiry, booking completion, and booking reminders together. Use this during testing when you want SportSpot to catch up all booking lifecycle operations at once.

---

## Phase 5: Open Game / Find Game
Future

Will include:
- Teams looking for players
- Join requests
- Role-based open slots

Do not implement until requested.

---

## Phase 6: Challenge Teams
Future

Will include:
- Challenge another team
- Accept/reject/counter proposal
- Challenge detail page

Do not implement until requested.

---

## Phase 7: Game Room
Future

Will include:
- Confirmed match workspace
- Lineups
- Booking pass
- Attendance
- Result
- Rating prompt

Do not implement until requested.

---

## Phase 8: Ratings and Reliability
Future

Will include:
- Post-match rating
- Reliability update
- No-show handling

Do not implement rating submission until requested.

---

## Phase 9: Rule-Based Recommendation
Future

Will include:
- Recommend open games
- Recommend teams
- Recommend courts
- Explain why recommendation was shown

Do not implement until requested.

---

## Phase 10: Future Expansion
Future

Will include:
- Production eSewa/Khalti payment
- Refund automation
- Split payment
- Advanced owner analytics
- Futsal support

Do not implement until requested.

---

# 12. Phase 2 Detailed Requirements

Now implement Phase 2 only:

PLAYER PROFILE AND CRICKSAL IDENTITY

Do not implement:
- Team model
- Team creation
- Venue model
- Court booking
- Payment
- Open games
- Challenge system
- Game Room
- Real notification backend
- Rating submission
- Recommendation
- Futsal

---

# 13. Phase 2 Backend Requirements

Create Django app named players if it does not already exist.

Create PlayerProfile model.

PlayerProfile fields:

- id
- user: OneToOneField to custom User
- sportspot_id: unique string generated automatically
- profile_photo: optional image field or optional URL field for now
- location
- weekly_availability
- playing_style
- skill_level with choices:
  - BEGINNER
  - INTERMEDIATE
  - ADVANCED
- preferred_cricksal_role with choices:
  - BATSMAN
  - BOWLER
  - ALL_ROUNDER
  - WICKETKEEPER
  - NONE
- reliability_score default 100
- average_rating default 0
- no_show_count default 0
- late_cancellation_count default 0
- completed_matches_count default 0
- created_at
- updated_at

Do not include preferred_sport because current MVP is Cricksal-only.
Do not include futsal_role.
Do not include futsal fields.

---

# 14. SportSpot ID Rule

sportspot_id should be generated automatically.

Format:

SSP-10001
SSP-10002
SSP-10003

Rules:
- Must be unique.
- Player should not manually enter it.
- It should be created when PlayerProfile is created.
- It should be visible on dashboard and profile page.

---

# 15. Backend Business Rules

1. Only users with role PLAYER can have PlayerProfile.
2. One PLAYER can have only one PlayerProfile.
3. COURT_OWNER cannot create PlayerProfile.
4. ADMIN cannot create PlayerProfile.
5. PlayerProfile must be linked to currently authenticated user.
6. If profile already exists, prevent duplicate profile.
7. If old player account does not have profile, API should handle safely.
8. Registration should automatically create PlayerProfile for player users.
9. If registration already collects skill level and location, copy those into PlayerProfile.
10. Current MVP sport is Cricksal, so profile is assumed to be Cricksal.

---

# 16. Registration Logic

When a user registers as PLAYER:

1. Create User account.
2. Automatically create PlayerProfile.
3. Copy these values from registration into PlayerProfile:
   - location
   - skill_level
4. Set preferred_cricksal_role = NONE by default.
5. Generate sportspot_id automatically.
6. Set reliability_score = 100.
7. Set average_rating = 0.
8. Set completed_matches_count = 0.
9. Set no_show_count = 0.
10. Set late_cancellation_count = 0.

Important:
Do not lose values selected during registration.
If the player selected location and skill level during registration, those values should appear in profile after login.

---

# 17. Profile Completion Logic

Create simple profile completion status.

Important fields for complete Cricksal profile:

- location
- skill_level
- weekly_availability
- playing_style
- preferred_cricksal_role

If any important field is missing or preferred_cricksal_role is NONE:
- Profile Status = Incomplete

If all important fields are filled:
- Profile Status = Complete

Dashboard should show:
- Complete Profile button if incomplete
- Edit Profile button if complete

---

# 18. Reliability Logic

Database default:

reliability_score = 100

But frontend should display new players carefully.

If completed_matches_count < 3:
Show:
- New Player
- Provisional Reliability
- Message: Reliability becomes meaningful after a few completed matches.

Do not make new players look fully proven.

If completed_matches_count >= 3:
Show actual reliability score normally.

Example:
New player:
Reliability: New Player
Completed Matches: 0
No-shows: 0

Experienced player:
Reliability: 92/100
Completed Matches: 7
No-shows: 0

---

# 19. API Requirements

Create authenticated APIs:

GET /api/players/profile/

Purpose:
Return currently logged-in player profile.

Behavior:
- If profile exists, return profile data.
- If profile does not exist, return clear response without crashing.

POST /api/players/profile/

Purpose:
Create profile for current player.

Rules:
- Only PLAYER can create.
- Prevent duplicate profile.
- Generate sportspot_id automatically.

PUT /api/players/profile/

Purpose:
Update full profile.

PATCH /api/players/profile/

Purpose:
Partially update profile.

Create:
- model
- serializer
- permissions
- views
- urls
- admin registration

Add players urls to main backend urls.py.

Use JWT authentication already present in the project.

---

# 20. Frontend Phase 2 Requirements

Create or update route:

/dashboard/player/profile

This page should:

1. Fetch current player profile from GET /api/players/profile/.
2. If profile exists, show edit form with saved values.
3. If profile does not exist, show create profile form safely.
4. Registration values like location and skill level should already be filled.
5. Player can edit location and skill level.
6. Player can add weekly availability.
7. Player can add playing style.
8. Player can select preferred Cricksal role.
9. Save using authenticated request.
10. Show loading state.
11. Show success message after save.
12. Show error message if API fails.
13. Keep design consistent with SportSpot.

---

# 21. Player Profile Page UI

Use dark theme with green accent.

Top profile card should show:

- Avatar placeholder
- Full name
- SportSpot ID
- Cricksal Player
- Skill level
- Location
- New Player / Provisional Reliability
- Completed matches
- Average rating

Main form sections:

## Section 1: Cricksal Identity

Fields:
- Skill Level:
  - Beginner
  - Intermediate
  - Advanced

- Location

- Weekly Availability

- Playing Style

## Section 2: Cricksal Role

Field:
Preferred Cricksal Role:
- Batsman
- Bowler
- All-rounder
- Wicketkeeper
- None

## Section 3: Trust Summary

Read-only fields:
- Reliability
- Completed Matches
- No-shows
- Late Cancellations
- Average Rating

Trust summary should not be editable by player.

---

# 22. Player Dashboard Update

Update:

/dashboard/player

Dashboard should show:

- Welcome back, player name
- Profile status:
  - Incomplete
  - Complete
- SportSpot ID
- Sport: Cricksal
- Skill level
- Location
- Preferred Cricksal role
- Reliability display:
  - New Player / Provisional Reliability if completed_matches_count < 3
- Completed matches
- No-shows
- Average rating

Quick action cards:
- Complete/Edit Profile → /dashboard/player/profile
- Find Game → placeholder
- Book Court → placeholder
- Create Team → placeholder
- Challenge Team → placeholder

Only Complete/Edit Profile needs to work in Phase 2.

---

# 23. Player Dashboard Sidebar

Sidebar should contain:

- Overview
- My Profile
- My Teams
- My Matches / Game Rooms
- My Bookings
- My Requests
- My Invitations
- My Ratings
- Settings

Do not include Notifications in sidebar.

Other pages can be placeholder routes for now.

---

# 24. Navbar Rules

Before login:

SportSpot | Courts | Find Game | Challenge Teams | Register Venue | Login | Sign Up

After PLAYER login:

SportSpot | Courts | Find Game | Challenge Teams | Bell Icon | Player Name Dropdown

Player dropdown:

- Dashboard
- My Profile
- Logout

Do not show Register Venue after player login.
Do not show Notifications in profile dropdown.

---

# 25. Placeholder Pages

Create placeholder pages if missing:

- /courts
- /find-game
- /challenge-teams
- /dashboard/player/teams
- /dashboard/player/matches
- /dashboard/player/bookings
- /dashboard/player/requests
- /dashboard/player/invitations
- /dashboard/player/ratings
- /dashboard/player/settings

These pages can show clean placeholder UI:
"This feature will be available in a later phase."

Do not implement their real logic yet.

---

# 26. Quality Requirements

- Keep authentication working.
- Keep login/register working.
- Keep JWT authenticated requests working.
- Keep role-based access working.
- Use clean DRF structure.
- Use TypeScript types for PlayerProfile.
- Use Tailwind CSS.
- Keep UI responsive.
- Handle loading state.
- Handle empty state.
- Handle success state.
- Handle error state.
- Do not hardcode real user values.
- Do not create duplicate player profiles.
- Do not add Futsal now.
- Do not build future modules early.

---

# 27. Commands to Run After Implementation

Backend:

cd backend
python manage.py makemigrations
python manage.py migrate
python manage.py runserver

Frontend:

cd frontend
npm run dev

---

# 28. Phase 2 Testing Checklist

After implementation, this should work:

1. Register a new PLAYER.
2. During registration, enter location and skill level.
3. Login as that player.
4. Open /dashboard/player.
5. Dashboard shows:
   - SportSpot ID
   - Sport: Cricksal
   - Skill level
   - Location
   - Profile status
6. Click Complete/Edit Profile.
7. /dashboard/player/profile opens.
8. Form is pre-filled with registration values.
9. Add:
   - Weekly availability
   - Playing style
   - Preferred Cricksal role
10. Save profile.
11. Success message appears.
12. Refresh page.
13. Saved data still appears.
14. Dashboard updates profile status.
15. PostgreSQL has data in players_playerprofile.
16. Court owner/admin cannot create player profile.
17. No Futsal fields appear anywhere in Phase 2 UI.

PostgreSQL check:

SELECT * FROM players_playerprofile;

---

# 29. Git Workflow

After Phase 2 works:

git status
git add .
git commit -m "Complete Phase 2 Cricksal player profile"
git push

Do not commit broken code.
Commit only after testing.

## Project Structure

```text
sportspot/
  backend/
    accounts/
    players/
    venues/
    sportspot_api/
    manage.py
    requirements.txt
  frontend/
    app/
    components/
    lib/
    types/
    package.json
  README.md
  .gitignore
  .env.example
```

## Tech Stack

Frontend:

- Next.js
- TypeScript
- Tailwind CSS

Backend:

- Django
- Django REST Framework
- PostgreSQL
- SimpleJWT

## Backend Setup

From the project root:

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy ..\.env.example .env
```

Create a PostgreSQL database matching your `.env` values. Example:

```sql
CREATE DATABASE sportspot_db;
```

Then run:

```bash
python manage.py makemigrations
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

Backend API base URL:

```text
http://127.0.0.1:8000
```

## Backend Auth APIs

Register:

```http
POST /api/auth/register/
```

Body:

```json
{
  "full_name": "Dipak Example",
  "email": "dipak@example.com",
  "phone": "9800000000",
  "password": "StrongPassword123!",
  "role": "PLAYER",
  "skill_level": "INTERMEDIATE",
  "location": "Kathmandu"
}
```

Registration creates an unverified account and sends a six-digit OTP. It does not return JWT tokens.

Verify email:

```http
POST /api/auth/verify-email/
```

```json
{
  "email": "dipak@example.com",
  "otp": "123456"
}
```

Resend verification code:

```http
POST /api/auth/verify-email/resend/
```

```json
{
  "email": "dipak@example.com"
}
```

Login:

```http
POST /api/auth/login/
```

Body:

```json
{
  "email": "dipak@example.com",
  "password": "strong-password"
}
```

Current user:

```http
GET /api/auth/me/
Authorization: Bearer <access_token>
```

Refresh token:

```http
POST /api/auth/token/refresh/
```

Forgot password:

```http
POST /api/auth/forgot-password/
```

This endpoint always returns a neutral response so it does not reveal whether an account exists.

Validate a reset link:

```http
POST /api/auth/reset-password/validate/
```

Reset password:

```http
POST /api/auth/reset-password/
```

Required body:

```json
{
  "token": "reset-link-token",
  "email": "dipak@example.com",
  "new_password": "NewStrongPassword123!",
  "confirm_password": "NewStrongPassword123!"
}
```

Email verification codes expire after 10 minutes, permit at most five incorrect attempts, and have a 60-second resend cooldown. Password-reset links are hashed in storage, expire after 15 minutes, and are single-use. A successful password reset increments the account security version so previously issued JWT access and refresh tokens stop working.

Password reset safety:

- The forgot-password API always returns the same response for every email, so attackers cannot check which emails are registered.
- A reset email is sent only when the account exists, is active, and has already verified its email.
- The reset form requires both the reset-link token and the matching SportSpot account email.
- A valid token cannot reset a different user's password.
- For local/FYP demo UX, set `ACCOUNT_RECOVERY_REVEAL_EMAIL_ERRORS=True` to show a clear error when the entered email is not registered or not verified.
- For production, set `ACCOUNT_RECOVERY_REVEAL_EMAIL_ERRORS=False` to avoid exposing which emails are registered.

## Transactional Email

Development defaults to Django's console email backend. OTPs and email links appear in the backend terminal:

```env
EMAIL_BACKEND=django.core.mail.backends.console.EmailBackend
```

For SMTP, set these only in `backend/.env`:

```env
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_HOST_USER=your-smtp-user
EMAIL_HOST_PASSWORD=your-smtp-password
EMAIL_USE_TLS=True
DEFAULT_FROM_EMAIL=SportSpot <no-reply@example.com>
SPORTSPOT_SUPPORT_EMAIL=support@example.com
FRONTEND_URL=http://localhost:3000
```

Never commit real SMTP credentials. Transactional delivery is centralized, deduplicated, and audited in `notifications_emaildelivery`. Email-provider failures are logged without rolling back registrations, bookings, invitations, venue reviews, or refund operations.

Current connected emails:

- Verification OTP, email verified, password reset, and password changed
- Team invitation
- Booking confirmation for player and owner
- Payment failure, booking cancellation, and owner-managed refund updates
- Venue submitted and venue verification status
- Important owner message about a valid booking
- Upcoming confirmed booking reminder

Run the reminder command periodically (for example, once per hour with Windows Task Scheduler or cron):

```bash
python manage.py send_booking_reminders
```

The command and email service use deduplication keys, so rerunning it does not send the same 24-hour reminder twice.

## Frontend Setup

From the project root:

```bash
cd frontend
npm install
copy .env.local.example .env.local
npm run dev
```

Frontend URL:

```text
http://localhost:3000
```

## Phase 1 Verification Checklist

- Backend dependencies install successfully.
- PostgreSQL database exists and matches `.env`.
- `python manage.py makemigrations` creates account migrations.
- `python manage.py migrate` applies migrations.
- `python manage.py createsuperuser` creates an admin account.
- `python manage.py runserver` starts the API server.
- Frontend dependencies install successfully.
- `npm run dev` starts the Next.js app.
- Register page can create `PLAYER` and `COURT_OWNER` users.
- Register page does not allow public `ADMIN` registration.
- Registration redirects to `/verify-email`.
- The OTP is accepted once, expires after 10 minutes, and old codes stop working after resend.
- Unverified accounts cannot log in or access protected APIs.
- Verified login receives JWT tokens.
- Forgot-password always shows the same neutral response.
- A reset link works once and expires after 15 minutes.
- Resetting a password invalidates previously issued JWT sessions.
- Login redirects users based on role:
  - `PLAYER` -> `/dashboard/player`
  - `COURT_OWNER` -> `/dashboard/owner`
  - `ADMIN` -> `/dashboard/admin`
- Navbar changes after login and logout.

## Product Identity

SportSpot is not only a booking system. It is a sports coordination platform built around real local problems: finding courts, finding players, finding opponents, confirming matches, coordinating teams, and building trust through reliability.

---

# Secure Account Email Flow

New public `PLAYER` and `COURT_OWNER` accounts must verify their email before login or access to protected APIs.

Registration flow:

1. `POST /api/auth/register/` creates an unverified account.
2. SportSpot sends a hashed, six-digit OTP through the configured Django email backend.
3. The frontend opens `/verify-email`.
4. `POST /api/auth/verify-email/` verifies the OTP and enables login.
5. `POST /api/auth/verify-email/resend/` creates a new OTP and invalidates older codes.

OTP security:

- Valid for 10 minutes
- Maximum 5 incorrect attempts
- 60-second resend cooldown
- Stored as a password hash, never returned by the API
- Existing users created before this migration remain verified
- Superusers created with `createsuperuser` are verified automatically

Password recovery:

- `POST /api/auth/forgot-password/`
- `POST /api/auth/reset-password/validate/`
- `POST /api/auth/reset-password/`
- Frontend pages: `/forgot-password` and `/reset-password?token=...`

Reset links are random, stored as SHA-256 digests, expire after 15 minutes, and are single-use. The reset endpoint checks that the entered account email matches the user who owns the reset token. A successful reset increments the user's authentication version, invalidating previously issued SportSpot JWT access and refresh sessions.

Password recovery visibility:

- Local/demo mode can show `No SportSpot account is registered with this email.`
- Production mode should use a neutral response so attackers cannot discover registered account emails.

## Transactional Email

Normal platform activity remains in the navbar Notification Centre. Email is reserved for important account and business events.

Connected working email events:

- Verification OTP and verification success
- Password reset and password-changed confirmation
- Cricksal team invitation
- Venue submitted, approved, needs changes, rejected, or suspended
- Booking confirmed for player and venue owner
- Mock payment failed
- Booking cancelled by player, venue, or SportSpot admin
- Refund pending and refund completed
- Important venue message for a valid booking
- Upcoming confirmed booking reminder

Challenge and match emails are not connected yet because those business modules are not implemented. No fake email events or broken links are generated.

Every delivery is created through `notifications/email_service.py`, rendered from shared HTML and text templates, and recorded in `notifications_emaildelivery`. Deduplication keys prevent duplicate email when an event endpoint is retried. Email errors are logged and recorded as `FAILED` without rolling back registration, booking, payment, team, refund, or venue transactions.

Run booking reminders periodically:

```bash
cd backend
python manage.py send_booking_reminders
```

For a deployed system, schedule this command hourly with the server's task scheduler. The deduplication key ensures each booking receives at most one 24-hour reminder.

Run unpaid reservation expiry frequently:

```bash
cd backend
python manage.py expire_reservations
```

For a deployed system, schedule this command every minute. It safely expires unpaid reservations, releases all selected slots, and avoids duplicate notifications on repeated runs.

Run completed-booking processing periodically:

```bash
cd backend
python manage.py complete_bookings
```

For a deployed system, schedule this command every 5-15 minutes or hourly. It marks paid confirmed bookings as completed after their final slot end time passes, keeps slot/payment history intact, and avoids duplicate notifications on repeated runs.

For local development and FYP demo, the easiest all-in-one command is:

```bash
cd backend
python manage.py run_booking_maintenance
```

It expires unpaid reservations, completes finished paid bookings, and sends eligible booking reminders in one run.

## Email Environment

Development uses the console backend, which prints the email and OTP/reset link in the Django terminal:

```env
EMAIL_BACKEND=django.core.mail.backends.console.EmailBackend
DEFAULT_FROM_EMAIL=SportSpot <no-reply@example.com>
SPORTSPOT_SUPPORT_EMAIL=support@example.com
```

For SMTP, keep credentials only in `backend/.env`:

```env
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_HOST_USER=your-smtp-user
EMAIL_HOST_PASSWORD=your-smtp-password
EMAIL_USE_TLS=True
EMAIL_TIMEOUT=10
DEFAULT_FROM_EMAIL=SportSpot <no-reply@your-domain.com>
FRONTEND_URL=http://localhost:3000
```

Never commit `backend/.env`. For Gmail, use an app password rather than the normal Gmail account password.

## Khalti Sandbox Payment

SportSpot supports Khalti Web Checkout in sandbox mode for the booking payment flow.

Backend environment variables:

```env
KHALTI_BASE_URL=https://dev.khalti.com/api/v2
KHALTI_SECRET_KEY=your-khalti-sandbox-live-secret-key
KHALTI_WEBSITE_URL=http://localhost:3000
KHALTI_RETURN_PATH=/dashboard/player/bookings/payment/khalti-return
```

Use the `live_secret_key` from the Khalti sandbox merchant dashboard. Do not put the Khalti dashboard Gmail password in the project.

To configure it safely on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\configure_khalti.ps1
```

Flow:

1. Player reserves one or more consecutive slots.
2. SportSpot creates a `RESERVED` booking for 10 minutes.
3. Player clicks `Pay with Khalti Sandbox`.
4. Backend calls Khalti initiate API and redirects the player to Khalti.
5. Khalti returns the player to SportSpot.
6. Backend calls Khalti lookup API.
7. If Khalti reports `Completed`, SportSpot confirms the booking, marks payment as `PAID`, and locks all selected slots as `BOOKED`.
8. If payment fails or expires, SportSpot releases all selected slots.

Khalti sandbox test wallet values are documented by Khalti:

- Khalti ID: 9800000000 to 9800000005
- MPIN: 1111
- OTP: 987654

### Enable Real Gmail Delivery On Windows

The console backend is a development preview only. It prints messages in the Django terminal and cannot deliver to an inbox. Delivery records created in this mode are labelled `CONSOLE_PREVIEW`, not `SENT`.

1. Turn on 2-Step Verification for the Gmail account SportSpot will send from.
2. Create a 16-character Google App Password for SportSpot.
3. From the project root, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\configure_gmail.ps1
```

4. Enter the sender Gmail address.
5. Enter the App Password when prompted. Input is hidden.
6. The script updates the ignored `backend/.env` and immediately sends a delivery test.
7. Restart Django after a successful test.

Never paste the Gmail App Password into chat, source code, README, or `.env.example`. Do not use the normal Gmail password.

You can rerun the delivery test at any time:

```powershell
cd backend
python manage.py check_email_delivery --to your-address@gmail.com
```

After SMTP works, an account stuck on `/verify-email` should click `Resend code`. A new OTP invalidates the old console-preview OTP. Password reset email is intentionally available only for active, verified accounts; the API still returns the same neutral response for every email address.

## Email Setup Commands

```bash
cd backend
python manage.py migrate
python manage.py check
python manage.py test accounts notifications venues teams
python manage.py runserver
```

```bash
cd frontend
npm install
npm run build
npm run dev
```

Manual verification:

1. Register a Player and inspect the console email for the OTP.
2. Confirm login is blocked before verification.
3. Verify with the OTP, then log in.
4. Register and verify a Court Owner the same way.
5. Request a new OTP after 60 seconds and confirm the old code fails.
6. Request a password reset for both an existing and unknown email; confirm both API responses are neutral.
7. Open the reset link, change the password, and confirm the link cannot be reused.
8. Confirm an old JWT no longer accesses `/api/auth/me/` after password reset.
9. Confirm team invitation, venue review, booking confirmation, cancellation, refund, and venue-message events create one matching email delivery.
10. Temporarily use an invalid SMTP configuration and confirm the main business action succeeds while Django admin shows a failed email delivery.
