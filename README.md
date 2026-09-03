# SportSpot

![SportSpot](frontend/public/images/sportspot-logo.png)

**Find Courts. Join Games. Challenge Teams. Play with Trust.**

SportSpot is a Nepal-focused web platform for Cricksal players, teams, court owners, and administrators. It brings court discovery, slot booking, player recruitment, team coordination, team challenges, notifications, chat, payments, attendance, reliability, ratings, and cricket scoring into one application.

SportSpot is currently an academic MVP/FYP project. The repository contains a working local development stack and deployment assets, but it is not presented as production-ready software.

## Contents

- [What is implemented](#what-is-implemented)
- [Roles and permissions](#roles-and-permissions)
- [Main user journeys](#main-user-journeys)
- [Technology stack](#technology-stack)
- [Architecture](#architecture)
- [Repository structure](#repository-structure)
- [Frontend routes](#frontend-routes)
- [Requirements](#requirements)
- [Local setup](#local-setup)
- [Environment configuration](#environment-configuration)
- [Running the application](#running-the-application)
- [Maintenance and scheduled work](#maintenance-and-scheduled-work)
- [API overview](#api-overview)
- [WebSockets and chat](#websockets-and-chat)
- [Data model](#data-model)
- [Testing](#testing)
- [Deployment](#deployment)
- [Security](#security)
- [Known limitations](#known-limitations)
- [Development workflow](#development-workflow)
- [License](#license)

## Current status

This is a verification snapshot for the checkout on **3 September 2026**.

| Area | Result |
| --- | --- |
| Git branch inspected | <code>main</code> |
| Django system check | Passed |
| Migration plan | All repository migrations applied in the configured local database |
| Backend app tests | Passed; 253 tests |
| Next.js production build | Passed; 52 application routes generated |
| TypeScript check | Passed after the Next.js build generated <code>.next/types</code> |
| Playwright browser tests | Passed; 6 Cricket Scorer tests |

The matchmaking service-area validation regression test now matches the current API response: <code>Choose a supported SportSpot service area.</code>.

## What is implemented

### Player experience

- Public Cricksal court and venue discovery.
- District, area, time, duration, price, facilities, and availability filtering.
- Map-based venue location display and player location preferences.
- Venue and court detail pages with reviews, comments, reactions, and reports.
- Player registration with a custom email-based account.
- Email verification using a one-time password.
- JWT login, refresh, logout/session clearing, password change, password recovery, and account deactivation.
- Player profile, SportSpot ID, profile photo, bio, availability, preferred area, skill level, and Cricksal role.
- Team creation and editing.
- Registered-player invitations by SportSpot ID.
- Guest team members and team member management.
- Wishlist support for venues and courts.
- Court slot reservation, multi-slot booking, payment handoff, booking details, cancellation, and refund status.
- Khalti payment initiation and verification when sandbox credentials are configured.
- Booking codes and owner-side QR/code verification.
- Notifications with unseen, seen, read, action, and related-entity states.
- Player ratings and reliability views.
- Cricket performance and completed scorecard viewing.

### Court owner experience

- Venue onboarding with venue details, photos, facilities, location, and verification documents.
- Admin review workflow before a venue is publicly discoverable.
- Map-based location selection, search, reverse lookup, and controlled SportSpot service-area resolution.
- Court creation, editing, deactivation, photo/media support, and pricing.
- Slot generation and future-slot clearing.
- Slot status management and calendar blocking.
- Owner calendar, booking list, reports, reviews, refund review, and booking messages.
- Booking verification through booking code or QR scan.
- Owner-side booking cancellation and refund record handling.

### Matchmaking and game rooms

- Pickup Game and Fill My Squad flows.
- Booking-first and plan-first game creation.
- Supported Cricksal role requirements.
- Join requests, invitations, host decisions, withdrawal, close/reopen recruitment, and participant management.
- Registered participants and guest participants.
- Schedule reconfirmation and overlap checks.
- Recruitment deadlines, stale-request expiry, waitlist-style recovery, and maintenance processing.
- Protected game rooms.
- Game-room REST chat and authenticated real-time chat.
- Attendance recording, bounded attendance disputes, reliability commitments, and rating eligibility.

### Team Challenges

- Direct team challenges and public open challenges.
- Multiple responses to an open challenge with creator-controlled opponent selection.
- Immutable proposal history and counter-proposals.
- Booking-first challenges and plan-first challenges.
- Booking attachment, rescheduling, reconfirmation, withdrawal, cancellation, and deadline handling.
- Active-captain permissions and team-pair safeguards.
- Protected confirmed-fixture rooms.
- Fixture lineups, eligible-player lookup, participant removal, attendance, disputes, result submission, and result confirmation.
- Fixture REST chat and authenticated real-time chat.
- Optional Cricket Scorer handoff for confirmed fixtures.

### Cricket Scorer

- Instant captain-to-captain scoring requests between player teams.
- Scorecard setup for a confirmed fixture.
- Squad confirmation for both teams.
- Scorer assignment.
- Toss recording and batting-order setup.
- First and second innings workflow.
- Ball-by-ball delivery recording.
- Runs, extras, wickets, batter changes, and bowler changes.
- Correction of the latest delivery by undo or edit.
- Completed scorecards.
- Player batting, bowling, and fielding performance derived from finalized scorecards.
- Team records derived from finalized scorecards.

### Administration

- Django Admin at <code>/admin/</code>.
- SportSpot admin dashboard at <code>/dashboard/admin</code>.
- Overview and operations pages.
- User directory and account activation/suspension.
- Venue review and approval workflow.
- Booking and payment oversight.
- Court feedback report review.
- Reliability and attendance dispute actions.

## Roles and permissions

| Role | Main capabilities | Important restrictions |
| --- | --- | --- |
| Guest | View public pages, discover venues/courts, register, log in, start account recovery | Cannot book, use teams, save wishlists, or access protected dashboards |
| Player | Use player dashboard, profile, teams, games, challenges, bookings, ratings, notifications, and scoring | Cannot manage venues, owner slots, owner refunds, or admin review |
| Court Owner | Set up and submit a venue, manage courts/slots, view bookings, verify arrivals, send booking messages, review refund records, and view reports | Cannot create player teams or approve venues |
| Admin | Review venues, manage users, oversee bookings/reports, moderate feedback reports, and resolve reliability cases | Admin accounts are created through <code>createsuperuser</code>, not public registration |

Public registration accepts only <code>PLAYER</code> and <code>COURT_OWNER</code>. <code>ADMIN</code> is intentionally blocked from public registration.

## Main user journeys

### Register and sign in

1. Open <code>/register</code>.
2. Select Player or Court Owner.
3. Submit the registration form.
4. Read the verification OTP from the configured email backend.
5. Open <code>/verify-email</code> and verify the account.
6. Sign in at <code>/login</code>.
7. The frontend stores the JWT session and routes the user to the correct dashboard.

With the default local configuration, email uses Django's console backend, so the OTP is printed in the backend terminal. Configure SMTP when the code must be delivered to a real mailbox.

### Book a court

1. Browse <code>/courts</code> or open a venue/court detail page.
2. Select one or more consecutive available slots.
3. Reserve the booking.
4. Complete payment through Khalti when payment credentials are configured.
5. Return through the Khalti callback route and verify the payment.
6. Use the booking detail page for the booking code, schedule, payment state, cancellation state, and messages.
7. The court owner can verify the booking at arrival using the code or QR scanner.
8. Maintenance completes finished bookings and creates eligible review/rating follow-up.

### Create a team

1. Open <code>/dashboard/player/teams</code>.
2. Create a team at <code>/dashboard/player/teams/create</code>.
3. Invite registered players using their SportSpot ID.
4. Add guests when a participant does not have an account.
5. Manage invitations, members, team photo, team roles, and team challenge eligibility.

### Create a pickup game

1. Open <code>/find-game</code> to discover games or create a game from <code>/dashboard/player/games/create</code>.
2. Choose Pickup or Fill My Squad, the preferred schedule/area, and role requirements.
3. Attach an eligible confirmed booking immediately, or create a plan-first game.
4. Accept join requests or invitations from the game management page.
5. Reconfirm the schedule when the game reaches its required state.
6. Coordinate from the protected game room.
7. Record attendance after the game and use the rating flow when eligible.

### Challenge another team

1. Open <code>/challenge-teams</code>.
2. Create a direct challenge or publish an open challenge.
3. Choose booking-first or plan-first scheduling.
4. Exchange proposals, decisions, counter-proposals, and confirmations.
5. Attach or reschedule a confirmed booking when a plan-first challenge is accepted.
6. Coordinate lineups and attendance in the protected fixture room.
7. Submit and confirm the result.
8. Start the Cricket Scorer for a supported confirmed fixture.

## Technology stack

| Layer | Technology | Repository location |
| --- | --- | --- |
| Frontend | Next.js 15, React 19, TypeScript | <code>frontend/</code> |
| Styling | Tailwind CSS 3, component-level CSS | <code>frontend/app/globals.css</code>, <code>frontend/tailwind.config.ts</code> |
| HTTP client | Axios with JWT injection and refresh retry | <code>frontend/lib/api.ts</code> |
| Maps | Leaflet and React Leaflet | <code>frontend/components/location/</code>, <code>frontend/components/venue/</code>, <code>frontend/components/owner/</code> |
| Browser tests | Playwright | <code>frontend/e2e/</code> |
| Backend | Django 5 and Django REST Framework | <code>backend/</code> |
| Authentication | Custom email user model and Simple JWT | <code>backend/accounts/</code> |
| Database | PostgreSQL | Django database configuration |
| Real-time layer | Django Channels, Daphne, optional Redis | <code>backend/sportspot_api/asgi.py</code> |
| Email | Django console backend or SMTP | <code>backend/notifications/</code> |
| Payments | Khalti Web Checkout API | <code>backend/venues/khalti.py</code> |
| Media | Local filesystem by default, optional S3 storage | <code>backend/sportspot_api/settings.py</code> |
| Static files | WhiteNoise and Django <code>collectstatic</code> | Backend deployment configuration |

The backend is a modular monolith. SportSpot is not split into microservices.

## Architecture

~~~text
Browser
  │
  ├── Next.js App Router UI
  │     ├── Axios REST client
  │     ├── JWT session in browser storage
  │     ├── Leaflet maps
  │     └── WebSocket clients
  │
  └── Django ASGI application
        ├── Django REST API
        ├── Django Admin
        ├── Django Channels consumers
        ├── PostgreSQL
        ├── Local media or S3
        ├── SMTP or console email
        ├── Khalti
        └── Optional Redis channel layer
~~~

The frontend calls the backend through <code>NEXT_PUBLIC_API_URL</code>. The backend reads configuration from <code>backend/.env</code>. The API uses a custom verified JWT authentication class, and the frontend automatically retries eligible requests after refreshing an expired access token.

## Repository structure

~~~text
.
├── backend/
│   ├── manage.py
│   ├── requirements.txt
│   ├── Procfile
│   ├── .ebextensions/          # Elastic Beanstalk settings
│   ├── sportspot_api/          # Settings, root URLs, ASGI/WSGI, health check
│   ├── accounts/               # Users, email verification, JWT, recovery, settings
│   ├── players/                # Profiles, commitments, reliability, ratings
│   ├── teams/                  # Teams, members, invitations, guests
│   ├── venues/                 # Venues, courts, slots, bookings, reviews, Khalti
│   ├── matchmaking/            # Pickup Game, Fill My Squad, game rooms, chat
│   ├── team_challenges/        # Challenges, proposals, fixtures, attendance, chat
│   ├── scoring/                # Cricket scorecards and performance records
│   ├── notifications/          # In-app notifications, email delivery, WebSockets
│   ├── wishlists/              # Player venue/court wishlists
│   └── admin_portal/           # Admin dashboard APIs
├── frontend/
│   ├── app/                    # Next.js routes
│   ├── components/             # Shared, player, owner, venue, and admin UI
│   ├── lib/                    # API, auth, dates, media, maps, realtime helpers
│   ├── types/                  # TypeScript API/domain types
│   ├── e2e/                    # Playwright browser tests
│   ├── public/images/          # SportSpot visual assets
│   ├── package.json
│   ├── next.config.ts
│   └── Procfile
├── scripts/                    # Windows setup and maintenance helpers
├── .env.example                # Backend environment template
├── .gitignore
└── README.md
~~~

## Frontend routes

The following routes are present in the Next.js App Router. A route being present does not mean every related workflow is fully production-ready.

### Public and account routes

| Route | Purpose |
| --- | --- |
| <code>/</code> | Landing page |
| <code>/courts</code> | Public court discovery |
| <code>/courts/[id]</code> | Court detail |
| <code>/find-game</code> | Public game discovery |
| <code>/find-game/[gameId]</code> | Game detail and join flow |
| <code>/challenge-teams</code> | Team challenge discovery |
| <code>/challenge-teams/create</code> | Create a team challenge |
| <code>/challenge-teams/[challengeId]</code> | Challenge detail |
| <code>/challenge-teams/[challengeId]/room</code> | Confirmed team fixture room |
| <code>/challenge-teams/[challengeId]/scorer</code> | Cricket scorecard workspace |
| <code>/login</code> | Sign in |
| <code>/register</code> | Player or Court Owner registration |
| <code>/verify-email</code> | OTP verification |
| <code>/forgot-password</code> | Start password recovery |
| <code>/reset-password</code> | Complete password recovery |
| <code>/scorer</code> | Cricket Scorer hub |
| <code>/support</code> | Support placeholder/page |

### Player routes

| Route | Purpose |
| --- | --- |
| <code>/dashboard/player</code> | Player overview |
| <code>/dashboard/player/profile</code> | Profile and preferences |
| <code>/dashboard/player/settings</code> | Account, password, privacy, and notification settings |
| <code>/dashboard/player/teams</code> | Team list and invitations |
| <code>/dashboard/player/teams/create</code> | Create a team |
| <code>/dashboard/player/teams/[id]</code> | Team detail and management |
| <code>/dashboard/player/invitations</code> | Invitations |
| <code>/dashboard/player/games</code> | Player games |
| <code>/dashboard/player/games/create</code> | Create a pickup/fill game |
| <code>/dashboard/player/games/[gameId]</code> | Game management |
| <code>/dashboard/player/games/[gameId]/room</code> | Game room |
| <code>/dashboard/player/bookings</code> | Booking list |
| <code>/dashboard/player/bookings/[bookingId]</code> | Booking detail |
| <code>/dashboard/player/bookings/payment/[bookingId]</code> | Khalti payment handoff |
| <code>/dashboard/player/bookings/payment/khalti-return</code> | Khalti return/verification |
| <code>/dashboard/player/ratings</code> | Ratings and reliability |
| <code>/dashboard/player/performance</code> | Cricket performance |
| <code>/dashboard/player/performance/scorecards/[fixtureId]</code> | Final scorecard viewer |
| <code>/dashboard/player/wishlist</code> | Saved venues and courts |

### Court Owner routes

| Route | Purpose |
| --- | --- |
| <code>/dashboard/owner</code> | Venue Manager overview |
| <code>/dashboard/owner/venue-setup</code> | Venue onboarding |
| <code>/dashboard/owner/venue</code> | Venue details and status |
| <code>/dashboard/owner/courts</code> | Court list |
| <code>/dashboard/owner/courts/create</code> | Create a court |
| <code>/dashboard/owner/courts/[id]/edit</code> | Edit a court |
| <code>/dashboard/owner/courts/[id]/slots</code> | Generate and manage court slots |
| <code>/dashboard/owner/availability</code> | Availability workspace |
| <code>/dashboard/owner/calendar</code> | Operational calendar and blocks |
| <code>/dashboard/owner/bookings</code> | Booking operations |
| <code>/dashboard/owner/refunds</code> | Refund review records |
| <code>/dashboard/owner/reviews</code> | Court feedback |
| <code>/dashboard/owner/reports</code> | Venue reports |
| <code>/dashboard/owner/settings</code> | Owner account and notification settings |

### Admin routes

| Route | Purpose |
| --- | --- |
| <code>/dashboard/admin</code> | Admin overview |
| <code>/dashboard/admin/venues</code> | Venue review |
| <code>/dashboard/admin/users</code> | User access management |
| <code>/dashboard/admin/bookings</code> | Booking oversight |
| <code>/dashboard/admin/reports</code> | Feedback reports |
| <code>/dashboard/admin/reliability</code> | Attendance/reliability cases |
| <code>/dashboard/admin/operations</code> | Operational data |
| <code>/dashboard/admin/settings</code> | Admin account settings |
| <code>/admin/</code> | Django Admin |

Some small compatibility/placeholder routes are intentionally present, including <code>/dashboard/player/matches</code>, <code>/dashboard/player/requests</code>, <code>/dashboard/settings</code>, and <code>/challenge-teams/details</code>. They should not be described as separate completed products.

## Requirements

- Git.
- Python 3.11 or newer.
- Node.js 18.18 or newer; Node.js 20 LTS is recommended.
- npm.
- PostgreSQL 14 or newer.
- A modern browser.

Optional integrations:

- SMTP provider for real email delivery.
- Khalti sandbox merchant credentials for payment testing.
- Redis for shared WebSocket delivery across multiple backend workers.
- AWS S3-compatible storage for persistent deployment media.

## Local setup

The commands below use PowerShell and work from the repository root on Windows. Equivalent commands work on macOS/Linux with the usual virtual-environment and copy-command changes.

### 1. Clone the repository

~~~powershell
git clone https://github.com/deepakshrestha23-lgtm/sportspot.git
cd sportspot
~~~

### 2. Create PostgreSQL databases

Create the development and test databases using a PostgreSQL role that matches <code>backend/.env</code>.

~~~sql
CREATE DATABASE sportspot_db;
CREATE DATABASE test_sportspot_db;
~~~

If you use a dedicated PostgreSQL role instead of <code>postgres</code>, create the role and make it the owner of both databases, then set <code>DB_USER</code>, <code>DB_PASSWORD</code>, <code>TEST_DB_USER</code>, and <code>TEST_DB_PASSWORD</code> accordingly.

On Windows, if <code>psql</code> is not on <code>PATH</code>, use the PostgreSQL installation path, for example:

~~~powershell
& 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -U postgres
~~~

### 3. Create backend configuration

~~~powershell
Copy-Item .env.example backend/.env
~~~

Open <code>backend/.env</code> and set at least:

- A real <code>SECRET_KEY</code>.
- The PostgreSQL password in <code>DB_PASSWORD</code>.
- Matching test database credentials.
- The frontend origin in <code>FRONTEND_URL</code> and <code>CORS_ALLOWED_ORIGINS</code> if it differs from the defaults.

The checked-in <code>.env.example</code> uses the console email backend and leaves Khalti unconfigured. Do not commit <code>backend/.env</code>.

### 4. Create the Python environment and install dependencies

~~~powershell
cd backend
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
~~~

If PowerShell blocks activation for the current process:

~~~powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
~~~

### 5. Apply migrations and create an admin

~~~powershell
python manage.py migrate
python manage.py createsuperuser
~~~

The superuser is created with the <code>ADMIN</code> role and can use both <code>/admin/</code> and <code>/dashboard/admin</code>.

### 6. Create frontend configuration and install packages

~~~powershell
cd ..\frontend
Copy-Item .env.local.example .env.local
npm ci
~~~

The default frontend configuration targets <code>http://127.0.0.1:8000</code>.

## Running the application

Open two terminals from the repository root.

### Terminal 1: Django API and WebSockets

~~~powershell
cd backend
.\.venv\Scripts\Activate.ps1
python manage.py runserver 127.0.0.1:8000
~~~

The backend health endpoint is [http://127.0.0.1:8000/api/health/](http://127.0.0.1:8000/api/health/).

### Terminal 2: Next.js frontend

~~~powershell
cd frontend
npm run dev
~~~

Open [http://localhost:3000](http://localhost:3000).

The custom <code>npm run dev</code> script requires port <code>3000</code>. It will replace an existing SportSpot Next.js process on that port, but it will not stop an unrelated application. Stop the unrelated process or choose a different local workflow before starting SportSpot.

### Production-style local checks

~~~powershell
cd frontend
npm run build
npm start
~~~

The Next.js configuration uses standalone output. <code>npm start</code> is the normal production server command after <code>npm run build</code>.

## Environment configuration

### Backend environment

The backend loads <code>backend/.env</code> through <code>python-dotenv</code>. The complete starter template is [.env.example](.env.example).

| Variable | Required | Purpose |
| --- | --- | --- |
| <code>SECRET_KEY</code> | Yes outside local-only use | Django signing key |
| <code>DEBUG</code> | Local only | Enables development behavior; use <code>False</code> for deployment |
| <code>ALLOWED_HOSTS</code> | Yes for deployment | Comma-separated Django hosts |
| <code>FRONTEND_URL</code> | Yes | Frontend origin and Khalti website default |
| <code>CORS_ALLOWED_ORIGINS</code> | Yes for split deployment | Comma-separated browser origins |
| <code>CSRF_TRUSTED_ORIGINS</code> | Deployment as needed | Trusted HTTPS/browser origins |
| <code>DB_NAME</code> | Yes | Development PostgreSQL database |
| <code>DB_USER</code> | Yes | Development PostgreSQL role |
| <code>DB_PASSWORD</code> | Yes | Development PostgreSQL password |
| <code>DB_HOST</code> | Yes | Defaults to <code>127.0.0.1</code> |
| <code>DB_PORT</code> | Yes | Defaults to <code>5432</code> |
| <code>TEST_DB_NAME</code> | Recommended | Separate test database |
| <code>TEST_DB_USER</code> | Recommended | Test database role |
| <code>TEST_DB_PASSWORD</code> | Recommended | Test database password |
| <code>TEST_DB_HOST</code> | Recommended | Test database host |
| <code>TEST_DB_PORT</code> | Recommended | Test database port |
| <code>SPORTSPOT_MUTATION_RATE</code> | No | Shared state-changing API throttle; defaults to <code>120/hour</code> |
| <code>REDIS_URL</code> | Production/multi-worker | Redis channel layer URL; local single-process fallback is in-memory |
| <code>KHALTI_BASE_URL</code> | Payment testing | Defaults to Khalti sandbox API |
| <code>KHALTI_SECRET_KEY</code> | Payment testing | Khalti sandbox secret; leave blank to disable payment calls |
| <code>KHALTI_WEBSITE_URL</code> | Payment testing | Website URL sent to Khalti |
| <code>KHALTI_RETURN_PATH</code> | Payment testing | Frontend payment return path |
| <code>EMAIL_BACKEND</code> | No | Console backend by default; use Django SMTP backend for delivery |
| <code>EMAIL_HOST</code> | SMTP only | SMTP hostname |
| <code>EMAIL_PORT</code> | SMTP only | SMTP port |
| <code>EMAIL_HOST_USER</code> | SMTP only | SMTP username/address |
| <code>EMAIL_HOST_PASSWORD</code> | SMTP only | SMTP password or app password |
| <code>EMAIL_USE_TLS</code> | No | TLS toggle |
| <code>EMAIL_USE_SSL</code> | No | SSL toggle; do not enable with TLS |
| <code>EMAIL_TIMEOUT</code> | No | SMTP connection timeout |
| <code>DEFAULT_FROM_EMAIL</code> | No | Sender shown in transactional emails |
| <code>SPORTSPOT_SUPPORT_EMAIL</code> | No | Support address |
| <code>LOCATION_GEOCODER_URL</code> | No | Geocoder endpoint; defaults to Nominatim |
| <code>LOCATION_GEOCODER_USER_AGENT</code> | No | Provider identification string |
| <code>LOCATION_GEOCODER_TIMEOUT</code> | No | Geocoder timeout in seconds |
| <code>ACCOUNT_RECOVERY_REVEAL_EMAIL_ERRORS</code> | No | Local account-recovery detail; disable in production |
| <code>USE_S3_MEDIA</code> | Production as needed | Switches default media storage to S3 |
| <code>AWS_STORAGE_BUCKET_NAME</code> | When S3 is enabled | S3 bucket name |
| <code>AWS_S3_REGION_NAME</code> | When S3 is enabled | AWS region |
| <code>AWS_S3_SIGNED_URL_TTL</code> | No | Signed media URL lifetime in seconds |
| <code>SECURE_SSL_REDIRECT</code> | Deployment as needed | Redirect HTTP to HTTPS |
| <code>SESSION_COOKIE_SECURE</code> | HTTPS deployment | Secure session cookie flag |
| <code>CSRF_COOKIE_SECURE</code> | HTTPS deployment | Secure CSRF cookie flag |

### Frontend environment

The frontend template is [frontend/.env.local.example](frontend/.env.local.example).

| Variable | Purpose |
| --- | --- |
| <code>NEXT_PUBLIC_API_URL</code> | Backend base URL, normally <code>http://127.0.0.1:8000</code> locally |
| <code>NEXT_PUBLIC_MAP_TILE_URL</code> | Leaflet tile URL |
| <code>NEXT_PUBLIC_MAP_ATTRIBUTION</code> | Map provider attribution |

Only public, non-secret values belong in <code>frontend/.env.local</code>. Never place API secrets, Khalti secrets, SMTP passwords, database passwords, or JWT signing keys in frontend variables.

### Configure SMTP

The default console backend is enough for local OTP and password-reset development. To configure Gmail SMTP on Windows:

~~~powershell
.\scripts\configure_gmail.ps1 -GmailAddress 'your-address@gmail.com'
~~~

The script prompts for the Google App Password, writes SMTP settings to <code>backend/.env</code>, and runs the email delivery check. A Google App Password is required; a normal Gmail password should not be used.

You can also run the delivery check directly:

~~~powershell
cd backend
python manage.py check_email_delivery --to your-address@example.com
~~~

### Configure Khalti sandbox

~~~powershell
.\scripts\configure_khalti.ps1
~~~

The helper stores sandbox settings in <code>backend/.env</code> and runs <code>python manage.py check</code>. Khalti payment initiation is unavailable until <code>KHALTI_SECRET_KEY</code> is configured.

## Maintenance and scheduled work

Several booking, matchmaking, reminder, and reliability transitions are designed to run through Django management commands.

Run one maintenance pass:

~~~powershell
cd backend
python manage.py run_sportspot_maintenance --limit 100
~~~

This processes expired unpaid reservations, finished bookings, booking reminders, matchmaking deadlines, and related lifecycle notifications through the services used by the project.

Run a development worker:

~~~powershell
python manage.py run_sportspot_maintenance --watch --interval 10 --reminder-every 300
~~~

Run individual operations:

~~~powershell
python manage.py expire_matchmaking --dry-run
python manage.py expire_matchmaking
python manage.py send_booking_reminders
python manage.py expire_reservations
python manage.py complete_bookings
python manage.py run_booking_maintenance
~~~

On Windows, the repository includes helpers for a scheduled task that runs maintenance every minute:

~~~powershell
.\scripts\register_sportspot_maintenance_task.ps1
.\scripts\unregister_sportspot_maintenance_task.ps1
~~~

The one-shot scheduled runner appends output to <code>.logs/sportspot-maintenance.log</code>. Do not run multiple independent maintenance workers against the same environment unless the deployment design accounts for that.

## API overview

The API is rooted at <code>http://127.0.0.1:8000/api/</code>. Protected endpoints use:

~~~http
Authorization: Bearer <access-token>
~~~

The route files under <code>backend/*/urls.py</code> are the authoritative endpoint list. There is no generated OpenAPI/Swagger document in this repository.

### Core endpoints

| Area | Base path | Main responsibility |
| --- | --- | --- |
| Health | <code>/api/health/</code> | Database readiness response |
| Auth | <code>/api/auth/</code> | Registration, login, verification, JWT refresh, recovery, account settings |
| Players | <code>/api/players/</code> | Profile, location lookup, dashboard, ratings, reliability, attendance resolution |
| Teams | <code>/api/teams/</code> | Teams, members, guests, invitations, player lookup |
| Venues | <code>/api/venues/</code> | Venue owner operations, discovery, courts, slots, bookings, reviews, refunds, Khalti |
| Matchmaking | <code>/api/matchmaking/</code> | Games, join requests, participants, invitations, rooms, chat, deadlines |
| Team Challenges | <code>/api/team-challenges/</code> | Team discovery, challenges, proposals, fixtures, attendance, results, chat |
| Scoring | <code>/api/scoring/</code> | Instant scoring requests, scorecard setup, innings, deliveries, performance |
| Notifications | <code>/api/notifications/</code> | Notification list, unseen count, seen/read state, actions |
| Wishlist | <code>/api/wishlist/</code> | Saved venue/court items |
| Admin portal | <code>/api/admin/</code> | Admin overview, users, bookings, reports, reliability, operations |

### Authentication endpoints

~~~text
POST /api/auth/register/
POST /api/auth/login/
GET  /api/auth/me/
POST /api/auth/token/refresh/
POST /api/auth/verify-email/
POST /api/auth/verify-email/resend/
POST /api/auth/forgot-password/
POST /api/auth/reset-password/validate/
POST /api/auth/reset-password/
GET/PATCH /api/auth/settings/player/
GET/PATCH /api/auth/settings/owner/
PATCH /api/auth/settings/account/
POST /api/auth/settings/password/
PATCH /api/auth/settings/notifications/
PATCH /api/auth/settings/owner/notifications/
PATCH /api/auth/settings/privacy/
POST /api/auth/settings/deactivate/
~~~

### Player and team endpoints

~~~text
GET/POST/PATCH /api/players/profile/
GET            /api/players/location/search/
GET            /api/players/location/reverse/
GET            /api/players/dashboard/overview/
GET            /api/players/ratings-reliability/
POST           /api/players/ratings/eligibilities/{eligibility_id}/submit/
POST           /api/players/attendance/{commitment_id}/resolve/

GET            /api/teams/my-teams/
GET            /api/teams/invitations/
POST           /api/teams/
GET/PATCH/DELETE /api/teams/{team_id}/
GET            /api/teams/players/lookup/
POST           /api/teams/{team_id}/invite/
POST           /api/teams/{team_id}/leave/
POST           /api/teams/{team_id}/members/guest/
DELETE         /api/teams/{team_id}/members/{member_id}/
POST           /api/teams/invitations/{member_id}/accept/
POST           /api/teams/invitations/{member_id}/reject/
~~~

### Venue and booking endpoints

~~~text
GET  /api/venues/discovery/reference/
GET  /api/venues/venues/
GET  /api/venues/venues/{venue_id}/
GET  /api/venues/courts/
GET  /api/venues/courts/{court_id}/
GET  /api/venues/courts/{court_id}/slots/
GET/POST /api/venues/courts/{court_id}/reviews/
GET/POST /api/venues/courts/{court_id}/reviews/comments/
POST /api/venues/courts/{court_id}/reviews/feedback/reactions/
POST /api/venues/courts/{court_id}/reviews/feedback/reports/

POST /api/venues/bookings/reserve/
GET  /api/venues/bookings/my/
GET  /api/venues/bookings/{booking_id}/
POST /api/venues/bookings/{booking_id}/cancel/
POST /api/venues/bookings/{booking_id}/khalti/initiate/
POST /api/venues/bookings/{booking_id}/khalti/verify/

GET/POST/PATCH/DELETE /api/venues/owner/venue/
POST           /api/venues/owner/venue/submit/
POST           /api/venues/owner/venue/deactivate/
GET/POST       /api/venues/owner/venue/photos/
GET/POST       /api/venues/owner/courts/
GET/PATCH/DELETE /api/venues/owner/courts/{court_id}/
POST           /api/venues/owner/courts/{court_id}/slots/generate/
POST           /api/venues/owner/courts/{court_id}/slots/clear/
GET            /api/venues/owner/calendar/
POST           /api/venues/owner/calendar/block/
GET            /api/venues/owner/slots/
POST           /api/venues/owner/slots/{slot_id}/{action}/
GET            /api/venues/owner/bookings/
POST           /api/venues/owner/bookings/verify/
POST           /api/venues/owner/bookings/{booking_id}/messages/
GET            /api/venues/owner/refunds/
POST           /api/venues/owner/refunds/{booking_id}/review/
GET            /api/venues/owner/reports/
GET            /api/venues/owner/reviews/
~~~

### Matchmaking and challenge endpoints

The main resources are:

- <code>/api/matchmaking/games/</code> for game creation, discovery, details, management, participants, guests, invitations, booking handoff, reconfirmation, cancellation, recruitment closure, rooms, and chat.
- <code>/api/matchmaking/requests/</code> for join-request decisions, withdrawals, and invitation responses.
- <code>/api/team-challenges/teams/</code> for public challenge-team discovery.
- <code>/api/team-challenges/challenges/</code> for direct/open challenge creation, detail, decisions, counter-proposals, opponent selection, booking attachment, reconfirmation, rescheduling, withdrawal, cancellation, rooms, and public responses.
- <code>/api/team-challenges/fixtures/</code> for eligible-player lookup, lineup participants, attendance/disputes, results, and fixture chat.

### Scoring endpoints

~~~text
GET  /api/scoring/my-performance/
GET  /api/scoring/teams/
GET/POST /api/scoring/match-requests/
POST /api/scoring/match-requests/{request_id}/{decision}/
GET  /api/scoring/fixtures/available/
GET  /api/scoring/fixtures/{fixture_id}/
POST /api/scoring/fixtures/{fixture_id}/setup/
POST /api/scoring/fixtures/{fixture_id}/squad/
POST /api/scoring/fixtures/{fixture_id}/scorer/
POST /api/scoring/fixtures/{fixture_id}/toss/
POST /api/scoring/fixtures/{fixture_id}/innings/start/
POST /api/scoring/fixtures/{fixture_id}/innings/bowler/
POST /api/scoring/fixtures/{fixture_id}/deliveries/
POST /api/scoring/fixtures/{fixture_id}/deliveries/undo/
POST /api/scoring/fixtures/{fixture_id}/deliveries/edit/
~~~

## WebSockets and chat

The ASGI application exposes these authenticated WebSocket routes:

~~~text
ws://127.0.0.1:8000/ws/notifications/
ws://127.0.0.1:8000/ws/games/{game_id}/chat/
ws://127.0.0.1:8000/ws/team-fixtures/{fixture_id}/chat/
~~~

For HTTPS deployments, the frontend converts these to <code>wss://</code>.

The browser sends the access token as the first JSON message instead of putting it in the URL:

~~~json
{"access_token":"<access-token>"}
~~~

Authentication must complete within 10 seconds. Room access is checked after authentication. REST remains the persisted source of truth, while WebSockets deliver notification/chat updates when the channel layer is available.

Chat rules currently include:

- Game-room and confirmed-fixture membership checks.
- Author-only message edits/deletes.
- A five-minute edit window.
- Cursor-paginated REST history.
- Client retry IDs for safer repeated sends.
- Soft-deleted message history.
- In-memory Channels fallback for a single local process.
- Redis-backed channel delivery for multi-worker deployments.

REST chat routes are:

~~~text
GET/POST/PATCH/DELETE /api/matchmaking/games/{game_id}/chat/
GET/PATCH/DELETE      /api/matchmaking/games/{game_id}/chat/{message_id}/
GET/POST/PATCH/DELETE /api/team-challenges/fixtures/{fixture_id}/chat/
GET/PATCH/DELETE      /api/team-challenges/fixtures/{fixture_id}/chat/{message_id}/
~~~

## Data model

| Django app | Important models | Responsibility |
| --- | --- | --- |
| <code>accounts</code> | <code>User</code>, <code>AccountSettings</code>, <code>EmailVerificationOTP</code>, <code>PasswordResetToken</code> | Identity and account security |
| <code>players</code> | <code>PlayerProfile</code>, <code>ParticipationCommitment</code>, <code>ParticipationAttendanceEvent</code>, <code>ReliabilityEvent</code>, <code>PlayerRating</code>, <code>PlayerRatingEligibility</code> | Player preferences, attendance, reliability, ratings |
| <code>teams</code> | <code>Team</code>, <code>TeamMember</code> | Player teams and membership |
| <code>venues</code> | <code>Venue</code>, <code>VenuePhoto</code>, <code>Court</code>, <code>CourtSlot</code>, <code>Booking</code>, <code>BookingSlot</code>, <code>BookingCheckIn</code>, <code>CourtReview</code>, <code>CourtReviewComment</code>, <code>CourtFeedbackReaction</code>, <code>CourtFeedbackReport</code>, <code>BookingMessage</code> | Marketplace, booking, feedback, and operations |
| <code>matchmaking</code> | <code>Game</code>, <code>GameRoleRequirement</code>, <code>GameParticipant</code>, <code>JoinRequest</code>, <code>JoinRequestEvent</code>, <code>GameChatMessage</code> | Pickup and Fill My Squad |
| <code>team_challenges</code> | <code>TeamChallenge</code>, <code>ChallengeProposal</code>, <code>OpenChallengeResponse</code>, <code>ChallengeEvent</code>, <code>TeamFixture</code>, <code>TeamFixtureParticipant</code>, <code>TeamFixtureChatMessage</code> | Team challenges and fixtures |
| <code>scoring</code> | <code>ScoringMatchRequest</code>, <code>CricketMatch</code>, <code>CricketSquadPlayer</code>, <code>CricketInnings</code>, <code>CricketDelivery</code>, <code>CricketPlayerPerformance</code> | Cricket scoring and derived records |
| <code>notifications</code> | <code>Notification</code>, <code>EmailDelivery</code> | In-app and transactional delivery |
| <code>wishlists</code> | <code>WishlistItem</code> | Player venue/court saves |

Database migrations live inside each app's <code>migrations/</code> directory. Use Django migrations for schema changes; do not edit an existing applied migration.

## Testing

### Backend

Run the Django checks and inspect migrations:

~~~powershell
cd backend
python manage.py check
python manage.py showmigrations --plan
~~~

Run the complete explicit application suite against the separate test database:

~~~powershell
python manage.py test accounts players teams matchmaking team_challenges notifications venues wishlists scoring --keepdb --noinput
~~~

The test suite covers authentication, profiles, teams, venues, bookings, notifications, wishlists, matchmaking, Team Challenges, chat, reliability, and Cricket Scorer behavior. The current verification snapshot is fully green.

### Frontend

From <code>frontend/</code>:

~~~powershell
npm ci
npm run build
npm exec tsc -- --noEmit
npm run test:e2e -- --reporter=line
~~~

The TypeScript command should be run after <code>npm run build</code> on a clean checkout because <code>tsconfig.json</code> includes Next-generated <code>.next/types</code>. Playwright starts a local Next.js server on port <code>3101</code> and currently covers the Cricket Scorer workflow in <code>frontend/e2e/cricket-scorer.spec.ts</code>.

### Useful targeted checks

~~~powershell
cd backend
python manage.py test matchmaking.tests.PickupGameApiTests.test_plan_first_rejects_unsupported_area

cd ..\frontend
npm run test:e2e -- --grep "scorecard"
~~~

Use <code>git diff --check</code> before committing documentation or code:

~~~powershell
git diff --check
~~~

## Deployment

The repository includes deployment-related files but does not claim a live production environment.

### Backend deployment assets

- <code>backend/Procfile</code> starts Daphne with <code>sportspot_api.asgi:application</code>.
- <code>backend/.ebextensions/01_sportspot.config</code> enables S3 media, runs migrations, and collects static files.
- <code>backend/.ebextensions/02_healthcheck.config</code> configures the Elastic Beanstalk process health path.
- <code>backend/.ebignore</code> excludes local secrets, virtual environments, logs, media, and static output.

### Frontend deployment assets

- <code>frontend/next.config.ts</code> enables standalone output.
- <code>frontend/Procfile</code> starts the standalone Next server.

### Required production work

Before a real deployment:

1. Use a managed PostgreSQL database and production credentials.
2. Set <code>DEBUG=False</code>, a secure <code>SECRET_KEY</code>, correct <code>ALLOWED_HOSTS</code>, CORS, CSRF origins, and HTTPS cookie settings.
3. Set <code>REDIS_URL</code> when more than one ASGI/backend worker can serve requests.
4. Configure SMTP and test verification, recovery, reminder, and transactional email delivery.
5. Configure production Khalti credentials and verify payment callback/reconciliation behavior.
6. Configure persistent media storage and a policy for private verification documents.
7. Run maintenance as a managed worker or scheduler.
8. Use a production-grade map tile/geocoding provider or obtain approval for the selected public services, including attribution, rate limits, and monitoring.
9. Add backups, logging, alerting, monitoring, CI/CD, and a rollback procedure.
10. Run backend, frontend, concurrency, payment, and browser-level regression tests in the target environment.

### Health-check mismatch to resolve

Django currently exposes the readiness endpoint at <code>/api/health/</code>. The committed Elastic Beanstalk health configuration currently names <code>/healthz</code>, which is not routed by <code>backend/sportspot_api/urls.py</code>. Align those two paths before relying on Elastic Beanstalk health status.

### S3 media note

Set <code>USE_S3_MEDIA=True</code>, <code>AWS_STORAGE_BUCKET_NAME</code>, and <code>AWS_S3_REGION_NAME</code> together. The backend raises a configuration error if S3 is enabled without the bucket and region. Keep S3 credentials in the deployment environment or IAM role, never in this repository.

## Security

Implemented protections include:

- Django password hashing and password validation.
- Unique normalized email accounts.
- Public registration restricted to Player and Court Owner roles.
- Email verification required before normal login/protected access.
- Hashed OTP codes with expiry, resend cooldown, and attempt limits.
- Hashed, single-use password-reset tokens.
- JWT access and refresh tokens with an auth-version check.
- Password changes, reset, and account suspension invalidate previous token versions.
- Role-based permission checks across player, owner, and admin APIs.
- Transactional locking for booking reservation and lifecycle-sensitive operations.
- Configurable mutation throttling for state-changing matchmaking and challenge actions.
- <code>.env</code>, <code>.env.local</code>, media, virtual environments, and build output excluded by <code>.gitignore</code>.
- WebSocket tokens are sent in the first message rather than in query strings.
- Owner location lookup is authenticated and public map coordinates are controlled by venue confirmation.

Development and production risks that remain:

- Browser JWT tokens are stored in <code>localStorage</code>; secure cookie-based auth is future work.
- The in-memory Channels layer is not suitable for multiple workers.
- Broader abuse prevention, moderation, and audit logging are incomplete.
- Local media is not a durable production media strategy.
- Verification-document access policy must be reviewed for production.
- Account-recovery error detail should be disabled in production.
- Public map/geocoder services require provider compliance and rate-limit planning.

## Known limitations

- The product scope is Cricksal-only; multi-sport UI is not implemented.
- The project is an academic MVP, not a complete commercial marketplace.
- Automated gateway refunds and owner offline booking workflows are not complete.
- Full concurrency and race-condition coverage is still required for reservations, challenge decisions, and payment transitions.
- Khalti end-to-end behavior requires valid sandbox credentials and provider availability.
- Frontend browser coverage focuses on Cricket Scorer and does not cover every booking, owner, matchmaking, challenge, notification, and admin state.
- Shared production WebSocket infrastructure, scheduled workers, monitoring, and CI/CD still need deployment work.
- Cricket scoring supports the current MVP rule set; advanced cricket rules, exports, richer correction tooling, and delegated scorer administration are future work.
- Cricket performance and team records are derived from finalized scorecards.
- Several compatibility/placeholder frontend pages remain.
- No formal architecture diagram, ERD, use-case diagram, generated API specification, or separate test report is stored in the repository.
- There is no open-source license file. See [License](#license).

## Development workflow

Before starting work:

~~~powershell
git status --short
git branch --show-current
git remote -v
~~~

For a feature or bug fix:

1. Inspect the affected frontend, backend, migration, permission, and test files.
2. Make the smallest scoped change.
3. Add or update migrations when models change.
4. Update this README when behavior, setup, environment, API, testing, or deployment changes.
5. Run relevant Django tests, <code>python manage.py check</code>, the frontend build/type check, and browser tests where applicable.
6. Run <code>git diff --check</code>.
7. Review the complete diff before staging.

Never commit:

- <code>backend/.env</code>
- <code>frontend/.env.local</code>
- Database passwords
- SMTP passwords or Google App Passwords
- Khalti secrets
- JWT/Django signing keys
- <code>node_modules/</code>
- <code>frontend/.next/</code>
- Python virtual environments
- Uploaded media, logs, or generated test reports

Example branch workflow:

~~~powershell
git checkout -b feature/short-description
git add README.md
git commit -m "Update SportSpot documentation"
git push origin feature/short-description
~~~

## License

No open-source license has been assigned. SportSpot is currently intended for academic and private development use.
