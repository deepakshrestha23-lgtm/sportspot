# SportSpot

SportSpot is a Nepal-focused sports web application for Cricksal players, teams, court owners, and administrators.

Current development status: active local development. Authentication, email verification, password recovery, player profiles, teams, invitations, venue onboarding, admin venue review, court discovery, multi-slot booking, Khalti payment verification, notifications, transactional emails, owner refund actions, and wishlist support exist in the repository. Open games, team challenges, Game Room, rating submission, disputes, production deployment, and several admin operations are not complete.

Current sport scope: Cricksal only.

Product statement: Find Courts. Join Games. Challenge Teams. Play with Trust.

## 1. Project Overview

SportSpot solves the local coordination problem around Cricksal in Nepal. Players need reliable ways to find verified courts, discover teammates or opponents, book available slots, coordinate teams, and build trust. Court owners need a structured way to publish venues, manage courts, generate slots, handle bookings, and communicate important updates. Admins need to review venue submissions before venues become visible to players.

The product is not only a court-listing website. The intended platform joins venue discovery, court booking, player identity, teams, invitations, notifications, email, payment, and trust information into one workflow.

## 2. Product Scope

Current scope:

- Cricksal-only web application.
- Roles: Guest, Player, Court Owner, Admin.
- Decoupled frontend and backend.
- Local-development focused MVP/FYP implementation.
- Khalti can use a development sandbox internally, but user-facing UI should show only Khalti.

Outside current scope:

- Multi-sport UI.
- Real automatic refund transfer.
- Split payment.
- Full open-game flow.
- Full team challenge flow.
- Game Room.
- Rating submission and recommendation engine.
- Production deployment and monitoring.

## 3. User Roles and Permissions

| Role | Purpose | Verified capabilities | Restrictions |
| --- | --- | --- | --- |
| Guest | Public visitor | View homepage and public court discovery, register, log in, request password reset | Cannot book, save wishlist, manage teams, or access dashboards |
| Player | Cricksal participant | Verify email, log in, maintain profile, upload profile photo, create teams, invite by SportSpot ID, add guests, accept/reject invitations, view member profile cards, save wishlist items, discover venues, reserve consecutive slots, pay with Khalti, view bookings, cancel eligible bookings, receive notifications | Cannot manage venues, slots, owner refunds, or admin review |
| Court Owner | Venue operator | Verify email, set up venue, upload photos/proof, submit for review, manage own courts, generate/block/unblock slots, view bookings, cancel own bookings, send booking messages, process owner-side refund records | Cannot create player teams or approve venues |
| Admin | Internal reviewer | Django admin access, frontend admin dashboard, venue approval/request-changes/rejection/suspension | Public registration is blocked; full users/bookings/reports/disputes admin is incomplete |

## 4. Technology Stack

| Layer | Technology | Purpose | Why selected |
| --- | --- | --- | --- |
| Frontend | Next.js 15, React 19 | App Router UI | Modern React routing and rendering |
| Frontend | TypeScript | Typed UI and API contracts | Reduces integration mistakes |
| Frontend | Tailwind CSS | Responsive styling | Fast consistent UI system |
| Frontend HTTP | Axios | API calls | JWT interceptor support |
| Backend | Django 5 | Main backend and admin | Mature Python framework |
| Backend API | Django REST Framework | JSON API | Serializers, views, permissions |
| Auth | SimpleJWT plus custom verified JWT auth | JWT login/refresh with email verification and auth-version checks | Stateless API auth with extra safety |
| Database | PostgreSQL | Persistent relational data | Fits bookings, slots, teams, users, notifications |
| Email | Django email backend via console or SMTP | OTP, reset links, transactional emails | Simple local and real SMTP support |
| Payment | Khalti Web Checkout API | Booking payment initiation and verification | Nepal-relevant payment provider |
| Media | Django local media storage | Uploaded images and documents | Practical for local/FYP development |

## 5. System Architecture

SportSpot uses a decoupled client-server architecture with a modular monolithic Django backend. It is not a microservices system.

```text
User
-> Next.js frontend
-> Django REST API
-> PostgreSQL / local media / SMTP / Khalti
-> Django REST API response
-> frontend UI update
```

Logical layers:

- Presentation: `frontend/app`, `frontend/components`, `frontend/lib`, `frontend/types`.
- Application/API: Django apps in `backend/accounts`, `players`, `teams`, `venues`, `notifications`, `wishlists`.
- Data/services: PostgreSQL, local media files, SMTP provider, Khalti.

No architecture diagram is currently present.

## 6. Repository Structure

```text
.
├── backend/
│   ├── manage.py
│   ├── requirements.txt
│   ├── sportspot_api/      # Django settings and root URLs
│   ├── accounts/           # User, JWT, OTP, password reset
│   ├── players/            # PlayerProfile and Cricksal identity
│   ├── teams/              # Teams, members, invitations, guests
│   ├── venues/             # Venues, courts, slots, booking, Khalti, policies
│   ├── notifications/      # Notification Centre and email delivery
│   └── wishlists/          # Player saved venues/courts
├── frontend/
│   ├── app/                # Next.js routes
│   ├── components/         # Navbar, Notification Centre, modals, toasts
│   ├── lib/                # API, auth, dates, toast helpers
│   ├── types/              # TypeScript domain types
│   └── public/images/      # Logo/auth/home assets
├── scripts/                # Windows helpers for Gmail/Khalti env setup
├── .env.example
├── .gitignore
└── README.md
```

## 7. Current Implementation Status

Status categories used here: Completed, Partially completed, In progress, Planned, Blocked, Needs verification.

### Authentication and Accounts

| Feature | Status | Evidence | Remaining work |
| --- | --- | --- | --- |
| Custom email user | Completed | `accounts.User` | Account suspension UI |
| Player/Court Owner registration | Completed | `/api/auth/register/`, `/register` | UX polish only |
| Admin public registration blocked | Completed | `RegisterSerializer.validate_role` | None known |
| Email OTP verification | Completed | `EmailVerificationOTP`, `/verify-email` | SMTP must be configured per environment |
| Login/JWT/refresh | Completed | `LoginSerializer`, `VerifiedTokenRefreshView` | Consider secure-cookie auth later |
| Forgot/reset password | Completed | `PasswordResetToken`, `/forgot-password`, `/reset-password` | Production should use neutral account recovery messaging |
| Logout | Completed | Frontend clears session | Backend refresh-token blacklist not implemented |
| Account suspension | Planned | No full moderation flow found | Add admin user controls |

### Player Profile

| Feature | Status | Evidence | Remaining work |
| --- | --- | --- | --- |
| PlayerProfile | Completed | `players/models.py` | Future-compatible Futsal fields exist but are hidden in current UI |
| SportSpot ID | Completed | `generate_sportspot_id` | Concurrency hardening later |
| Profile view/update | Completed | `/api/players/profile/`, `/dashboard/player/profile` | Broader tests |
| Profile photo upload | Completed | `profile_photo` and UI | Size/compression rules |
| Reliability display | Partially completed | counters and labels | Real match/no-show engine missing |
| Ratings | Partially completed | `average_rating` fields | Rating submission missing |
### Team Management

| Feature | Status | Evidence | Remaining work |
| --- | --- | --- | --- |
| Create team | Completed | `TeamCreateView`, `/dashboard/player/teams/create` | More validation |
| Captain membership | Completed | creator added as CAPTAIN | Role transfer not implemented |
| Team photo | Completed | `team_photo` | Image size policy |
| Invite by SportSpot ID | Completed | `/api/teams/players/lookup/`, `/invite/` | Optional invitation expiry |
| Accept/reject invitation | Completed | `/api/teams/invitations/` | None known |
| Guest player | Completed | `/members/guest/` | Extended guest lifecycle |
| Remove member/invitation | Completed | status-based removal | Soft history improvements |
| Public team browsing | Planned | No public team discovery backend | Needed for challenges |

### Open Games

| Feature | Status | Evidence | Remaining work |
| --- | --- | --- | --- |
| Find Game page | Planned | `frontend/app/find-game/page.tsx` states later phase | Build models/API/UI |
| Create open game | Planned | No backend model/API found | Define open-game domain |
| Join requests | Planned | Notification types reserved only | Build request workflow |

### Team Challenges

| Feature | Status | Evidence | Remaining work |
| --- | --- | --- | --- |
| Challenge pages | Planned | placeholder pages in `challenge-teams` | Build real challenge module |
| Accept/counter/decline | Planned | no challenge model/API found | Add lifecycle and notifications |
| Game Room creation | Planned | no match/game-room model found | Depends on challenge/open-game flow |

### Venue and Court Discovery

| Feature | Status | Evidence | Remaining work |
| --- | --- | --- | --- |
| Approved venue listing | Completed | `/api/venues/venues/`, `/courts` | More real seed data |
| Venue-first flow | Completed | venue cards and `/courts/[id]` | Card UX can improve |
| Reference filters | Completed | `/api/venues/discovery/reference/`, `reference_data.py` | Add geolocation later |
| District filter | Completed | Kathmandu, Lalitpur, Bhaktapur from backend | None known |
| Area filter | Completed | district-dependent values | Searchable dropdown later |
| Venue type filter | Completed | Indoor, Outdoor, Covered taxonomy | None known |
| Facilities filter | Completed | backend catalogue | Align labels over time |
| Date/time/duration filters | Completed | backend validation and URL params | Mobile filters apply immediately |
| Price filter | Completed | real slot prices | Optional slider |
| Rating filter/sort | Partially completed | rating fields/sort option | no real rating workflow |
| Pagination | Completed | API and UI | None known |

### Court Owner

| Feature | Status | Evidence | Remaining work |
| --- | --- | --- | --- |
| Owner dashboard states | Completed | `/dashboard/owner` | More operational polish |
| Venue setup wizard | Completed | `/dashboard/owner/venue-setup` | More validation polish |
| Draft and submit | Completed | `OwnerVenueView`, `OwnerVenueSubmitView` | None known |
| Photos/proof upload | Completed | `VenuePhoto`, document fields, upload APIs | Production private storage |
| Admin status handling | Completed | DRAFT/PENDING/NEEDS_CHANGES/APPROVED/REJECTED/SUSPENDED | Audit logs later |
| Court management | Completed | owner court APIs/pages | Reactivation unclear |
| Slot generation/pricing | Completed | `GenerateSlotsView` | No peak pricing |
| Block/unblock slots | Completed | `SlotStatusView` | Richer calendar later |
| Offline booking | Planned | navigation concept but no complete model/API | Build owner offline booking flow |

### Booking

| Feature | Status | Evidence | Remaining work |
| --- | --- | --- | --- |
| Select court/date/slots | Completed | `/courts/[id]` | UX polish |
| Multi-slot reservation | Completed | `BookingSlot`, `slot_ids` | More edge-case tests |
| 10-minute hold | Completed | `reserved_until` | Scheduler needed in deployment |
| Double-booking prevention | Completed | transactions and `select_for_update` | Load testing later |
| Past-time blocking | Completed | `is_past`, backend validation | Timezone verification in deployment |
| Khalti initiation | Completed | `KhaltiPaymentInitiateView` | Requires valid env key |
| Khalti verification | Completed | lookup before confirmation | Needs live sandbox end-to-end verification |
| Booking pass/history | Completed | player booking pages | Print/download later |
| Cancellation | Completed | `BookingCancelView`, `policies.py` | More tests for all tiers |
| Owner refund actions | Completed | owner refund APIs/page | Real money transfer not implemented |
| Expiry/completion commands | Completed | `expire_reservations`, `complete_bookings`, `run_booking_maintenance` | Schedule in deployment |

### Notifications and Feedback

| Feature | Status | Evidence | Remaining work |
| --- | --- | --- | --- |
| Notification Centre | Completed for connected modules | `notifications` app, `NotificationCenter.tsx` | Connect future modules later |
| Seen/read behaviour | Completed | model timestamps and IntersectionObserver | Accessibility testing |
| Bell badge and polling | Completed | Navbar polls unseen count | WebSockets future scope |
| Notification actions | Partially completed | team invite/open actions | challenge/join actions await modules |
| Transactional emails | Completed for connected modules | `email_service.py`, templates, `EmailDelivery` | Configure SMTP |
| Global toast system | Completed | `ToastProvider`, `emitToast`, `FeedbackToast` | Some persistent page errors remain intentionally inline |

### Administration

| Feature | Status | Evidence | Remaining work |
| --- | --- | --- | --- |
| Django admin | Completed | app admin files | Production hardening |
| Frontend admin dashboard | Partially completed | `/dashboard/admin` | More metrics/actions |
| Venue review | Completed | `/dashboard/admin/venues` and admin review API | Audit log |
| User management | Planned | no dedicated page | Build moderation UI |
| Booking oversight | Partially completed | backend permission logic exists | frontend admin booking page missing |
| Reports/disputes | Planned | no models/pages | Build later |

### Testing and Deployment

| Feature | Status | Evidence | Remaining work |
| --- | --- | --- | --- |
| Backend tests | Partially completed | tests in accounts, teams, venues, notifications, wishlists | Broaden coverage |
| Frontend tests | Planned | no test runner found | Add Playwright or React tests |
| API docs | Planned | no Swagger/OpenAPI | Add schema/docs |
| Deployment | Planned | no Docker/CI/deployment config found | Build deployment pipeline |

## 8. Completed Work

Verified completed work includes:

- Decoupled Next.js frontend and Django REST backend.
- PostgreSQL-backed settings.
- Email-based custom user model.
- Public Player/Court Owner registration and admin-only superuser creation.
- Email OTP verification and secure password recovery.
- JWT authentication with verified-user and auth-version checks.
- Cricksal player profile with SportSpot ID, photo, location, skill, role, availability, style, and trust counters.
- Team creation, captain permissions, registered invitation by SportSpot ID, guest players, member cards, and invitation decisions.
- Court owner venue setup, photo gallery, verification document upload, admin review, court setup, slot generation, and slot blocking.
- Venue-first public discovery with stable backend filter reference data.
- Consecutive multi-slot booking, 10-minute holds, Khalti payment verification, booking pass/history, cancellation, and owner-managed refund records.
- Central Notification Centre and global toast feedback.
- Transactional email service with delivery audit table.
- Player wishlist for venues/courts.

## 9. Partially Completed and In-Progress Work

- Ratings/reliability are displayed but not calculated from real post-match ratings.
- Challenge and open-game screens exist only as placeholders.
- Game Room is not implemented.
- Admin venue review works, but broader admin operations are incomplete.
- Owner offline booking is not implemented as a full feature.
- Khalti needs environment configuration and real end-to-end verification after credentials are added.
- Media handling is local-development only.
- Frontend lacks automated tests.

## 10. Remaining Features and Prioritized Roadmap

### Priority 0 - Critical correctness and security

| Objective | Current status | Main tasks | Dependencies | Completion criteria |
| --- | --- | --- | --- | --- |
| Verify Khalti end-to-end | Needs verification | Configure env, reserve booking, pay, verify lookup | Khalti credentials | Confirmation only after verified payment |
| Harden secrets | Partially completed | Review env, docs, frontend bundle | None | No secrets in git or user-facing screens |
| Expand booking race tests | Partially completed | Add concurrent reservation tests | Booking API | Same slot cannot confirm twice |
| Secure proof documents | Planned | Protected file access or private storage | Deployment/storage choice | Only owner/admin can access proof files |
| Production recovery policy | Partially completed | Set neutral disclosure in prod | Env config | Unknown emails are not exposed |

### Priority 1 - Complete core MVP

| Objective | Current status | Main tasks | Dependencies | Completion criteria |
| --- | --- | --- | --- | --- |
| Finish booking UX QA | In progress | Test reservation, payment, cancellation, refund, notifications | Existing booking flow | Smooth player/owner booking lifecycle |
| Complete owner operations | Partially completed | Offline booking/block-slot workflow | Venue/court slots | Owner can protect offline bookings |
| Admin operations | Partially completed | Users/bookings/refund overview | Permissions | Admin can review operational risks |
| Open games | Planned | Models, APIs, UI, join requests | Player/team modules | Players can find/request games |
| Team challenges | Planned | Challenge lifecycle and notifications | Team module | Captains can accept/counter/decline |

### Priority 2 - Operational completeness

| Objective | Current status | Main tasks | Dependencies | Completion criteria |
| --- | --- | --- | --- | --- |
| Ratings/reliability | Planned | Rating model, eligibility, reliability updates | Completed games | Ratings affect trust displays |
| Game Room | Planned | Match room model and UI | Challenge/open-game flow | Confirmed games have coordination page |
| Disputes/reports | Planned | Models, admin review, notifications | Booking/match flows | Users can report serious issues |
| Notification expansion | Partially completed | Connect only real future module events | New modules | No fake or broken notifications |

### Priority 3 - Quality and production readiness

| Objective | Current status | Main tasks | Dependencies | Completion criteria |
| --- | --- | --- | --- | --- |
| Frontend tests | Planned | Add Playwright/component tests | Stable UI | Core flows tested |
| API docs | Planned | Add OpenAPI/Swagger or curated docs | Stable APIs | Developer can use endpoints easily |
| Performance | Partially completed | Query review, indexes, pagination | More data | Discovery/dashboard stay fast |
| Deployment | Planned | Hosting, envs, DB, media, static, scheduler | Infrastructure | Staging/prod runs reliably |
| Monitoring | Planned | Logs, error monitoring, backups | Deployment | Operators can diagnose failures |
## 11. Core User Workflows

### Registration and email verification

1. User registers as Player or Court Owner.
2. Backend creates account with `email_verified=False`.
3. Backend sends hashed 6-digit OTP by email.
4. User enters OTP at `/verify-email`.
5. Backend checks expiry, attempts, and hash.
6. User can log in after verification.

### Login and JWT authentication

1. User enters email and password.
2. Backend authenticates and blocks unverified accounts.
3. Backend returns access and refresh tokens.
4. Frontend stores session and redirects by role.
5. API requests include bearer token.

### Team creation and invitation

1. Player completes profile.
2. Player creates team and becomes captain.
3. Captain looks up a player by SportSpot ID.
4. Captain sends invitation.
5. Invited player accepts or rejects.
6. Accepted player becomes active member.

### Open-game join request

Status: Planned. No complete model/API exists yet.

### Team challenge

Status: Planned. Current pages are placeholders.

### Venue onboarding and verification

1. Court Owner completes venue setup.
2. Owner adds courts and slots.
3. Owner uploads photos and verification document.
4. Owner submits for review.
5. Admin approves, requests changes, rejects, or suspends.
6. Approved active venues appear to players.

### Venue discovery

1. Guest/player opens `/courts`.
2. Frontend requests `/api/venues/venues/`.
3. Backend applies filters and availability logic.
4. User opens venue detail.

### Court and slot selection

1. User selects venue.
2. User selects court.
3. User selects date and duration.
4. UI shows available slots for that court/date.
5. User selects consecutive slots.

### Khalti booking payment

1. Player reserves selected slots.
2. Backend locks and rechecks slots transactionally.
3. Booking is `RESERVED` for about 10 minutes.
4. Player continues to Khalti.
5. Backend verifies Khalti lookup after return.
6. If complete, booking becomes `CONFIRMED` and slots become `BOOKED`.
7. If failed/expired, booking is not confirmed and slots are released.

### Booking cancellation

1. User opens booking.
2. UI shows refund/cancellation preview.
3. Backend calculates policy outcome from booking snapshot.
4. All booking slots are updated together.
5. Notifications/emails are generated where connected.

### Refund handling

1. SportSpot calculates refund eligibility.
2. Owner-caused paid cancellations require full refund.
3. Owner records refund processing in `/dashboard/owner/refunds`.
4. Player is notified of refund status.
5. Real money transfer is not automated in this MVP.

### Notification delivery

1. Backend event calls `notifications/services.py`.
2. Service creates a deduplicated notification.
3. Navbar polls unseen count.
4. Visible drawer cards become seen after about one second.
5. Clicking or acting marks notifications read.

### Rating after a completed match

Status: Planned. Rating fields exist, but rating submission is not implemented.

## 12. Court Discovery and Filtering Model

Filter design uses two concepts:

- Master/reference filter options: stable supported values from backend configuration.
- Current result data: counts, prices, availability, and venue cards from the current query.

Valid filter options must not disappear just because the current database has no matching venue.

Implemented reference values:

- Districts: Kathmandu, Lalitpur, Bhaktapur.
- Areas: dependent on district.
- Venue types: Indoor, Outdoor, Covered.
- Facilities: controlled backend catalogue.
- Time periods: Morning, Afternoon, Evening.
- Durations: 1 hour, 2 hours, 3 hours.

Implemented query features:

- Search.
- District and area.
- Date with past-date prevention.
- Preferred time and exact start time.
- Duration with consecutive-slot availability.
- Min/max price from real slot prices.
- Venue type.
- Facilities.
- Sorting and pagination.
- URL query parameters.
- Zero-result states.

Known limitation: mobile filters update immediately; a staged Apply flow would be better.

## 13. Booking and Payment Rules

Correct relationship:

```text
Venue -> Courts -> CourtSlots -> Booking
```

Implemented rules:

- Booking uses one venue, one court, one date, and one or more consecutive slots.
- Multiple courts or multiple dates in one booking are not supported.
- Backend rechecks availability before reservation.
- Reservation uses transaction locks.
- Slots are held for about 10 minutes.
- Khalti confirmation happens only after backend verification.
- Failed payment does not confirm booking.
- Expiry releases unpaid holds.
- Cancellation updates all slots atomically.
- Confirmed bookings can become completed after the final slot end time.

Statuses:

```text
Booking: RESERVED, CONFIRMED, CANCELLED, EXPIRED, COMPLETED
Payment: PENDING, PAID, CANCELLED, FAILED, REFUND_PENDING, REFUNDED, PARTIALLY_REFUNDED, NO_REFUND
Refund: NOT_REQUIRED, PENDING_OWNER_ACTION, NOT_ELIGIBLE, REJECTED, REFUNDED, PARTIALLY_REFUNDED
Slot: AVAILABLE, RESERVED, BOOKED, BLOCKED, CANCELLED
```

Cancellation policy:

- Unpaid reservation cancellation releases slots and needs no refund.
- Player cancellation before full-refund cutoff gets 100% refund.
- Player cancellation inside partial-refund window gets configured partial percentage.
- Late player cancellation gets no refund.
- Venue-caused paid cancellation requires full refund.
- Policy snapshot is saved on booking so later venue edits do not alter old bookings.

Do not publish payment test phone numbers, PINs, one-time codes, or secret keys in this README.

## 14. Notification and User Feedback Design

### Notification Centre

Persistent notifications are used for important records and actions:

- Team invitation updates.
- Venue verification updates.
- Booking reservation, confirmation, payment failure, cancellation, completion.
- Refund pending/completed or rejected owner-side outcome.
- Important venue message for a booking.

Notification Centre behaviour:

- Navbar bell after login.
- Badge counts unseen notifications.
- Cards become seen after actual visibility in the drawer.
- Clicking or acting marks read.
- Filters and pagination exist.
- Polling is used; WebSockets are future scope.

### Toast Feedback

Toasts are temporary immediate feedback:

- Global `ToastProvider`.
- Top-centre on mobile, top-right on desktop.
- Types: success, error, warning, info.
- Auto-dismiss and manual close.
- Dedupe support.
- ARIA live region.

Field-specific validation should stay beside the relevant field.
## 15. Environment Variables

The backend reads `backend/.env`. The root `.env.example` is a safe template. The frontend reads `frontend/.env.local`.

| Variable | Purpose | Required | Example placeholder |
| --- | --- | --- | --- |
| `SECRET_KEY` | Django secret | Yes | `replace-with-secure-secret` |
| `DEBUG` | Local debug | Yes | `True` |
| `DB_NAME` | PostgreSQL DB | Yes | `sportspot_db` |
| `DB_USER` | DB user | Yes | `postgres` |
| `DB_PASSWORD` | DB password | Yes | `your_database_password` |
| `DB_HOST` | DB host | Yes | `127.0.0.1` |
| `DB_PORT` | DB port | Yes | `5432` |
| `FRONTEND_URL` | Frontend origin | Yes | `http://localhost:3000` |
| `KHALTI_BASE_URL` | Khalti API URL | Payment | `https://dev.khalti.com/api/v2` |
| `KHALTI_SECRET_KEY` | Khalti secret key | Payment | `your_khalti_secret_key` |
| `KHALTI_WEBSITE_URL` | Website URL for Khalti | Payment | `http://localhost:3000` |
| `KHALTI_RETURN_PATH` | Payment return path | Payment | `/dashboard/player/bookings/payment/khalti-return` |
| `EMAIL_BACKEND` | Django email backend | Yes | `django.core.mail.backends.console.EmailBackend` |
| `EMAIL_HOST` | SMTP host | SMTP | `smtp.gmail.com` |
| `EMAIL_PORT` | SMTP port | SMTP | `587` |
| `EMAIL_HOST_USER` | SMTP username | SMTP | `your_sender_email@example.com` |
| `EMAIL_HOST_PASSWORD` | SMTP App Password | SMTP | `your_email_app_password` |
| `EMAIL_USE_TLS` | SMTP TLS | SMTP | `True` |
| `EMAIL_USE_SSL` | SMTP SSL | SMTP | `False` |
| `EMAIL_TIMEOUT` | Email timeout | Optional | `10` |
| `DEFAULT_FROM_EMAIL` | Sender identity | Yes | `SportSpot <no-reply@example.com>` |
| `SPORTSPOT_SUPPORT_EMAIL` | Support email | Optional | `support@example.com` |
| `ACCOUNT_RECOVERY_REVEAL_EMAIL_ERRORS` | Local/demo reset error visibility | Optional | `True` locally, `False` in production |
| `NEXT_PUBLIC_API_URL` | Frontend API URL | Frontend | `http://127.0.0.1:8000` |

Never commit real secrets.

## 16. Local Development Setup

Prerequisites:

- Git.
- Python 3.12 or compatible Python 3 version for Django 5.
- PostgreSQL 17 or compatible PostgreSQL version.
- Node.js compatible with Next.js 15.
- npm.

Backend on Windows:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy ..\.env.example .env
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

Backend on Linux/macOS:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

Create PostgreSQL database before migration if it does not exist:

```sql
CREATE DATABASE sportspot_db;
```

Frontend:

```powershell
cd frontend
npm install
copy .env.local.example .env.local
npm run dev
```

Local URLs:

- Frontend: `http://localhost:3000`
- Backend: `http://127.0.0.1:8000`
- Django admin: `http://127.0.0.1:8000/admin/`

## 17. Database and Migrations

Database engine: PostgreSQL.

Main domain tables include accounts, email OTPs, password reset tokens, player profiles, teams, team members, venues, venue photos, courts, court slots, bookings, booking slots, booking messages, notifications, email deliveries, and wishlist items.

Migration commands:

```powershell
cd backend
python manage.py makemigrations
python manage.py migrate
```

Lifecycle commands:

```powershell
python manage.py expire_reservations
python manage.py complete_bookings
python manage.py send_booking_reminders
python manage.py run_booking_maintenance
```

No verified seed-data command or ER diagram is present.

## 18. API Overview

Authentication: `/api/auth/`

- `POST register/`
- `POST login/`
- `GET me/`
- `POST verify-email/`
- `POST verify-email/resend/`
- `POST forgot-password/`
- `POST reset-password/validate/`
- `POST reset-password/`
- `POST token/refresh/`

Players: `/api/players/`

- `GET/POST/PUT/PATCH profile/`

Teams: `/api/teams/`

- `GET my-teams/`
- `POST /`
- `GET/PUT/PATCH/DELETE {team_id}/`
- `GET players/lookup/`
- `POST {team_id}/invite/`
- `POST {team_id}/members/guest/`
- `DELETE {team_id}/members/{member_id}/`
- `GET invitations/`
- `POST invitations/{member_id}/accept/`
- `POST invitations/{member_id}/reject/`

Venues/bookings: `/api/venues/`

- Owner venue/courts/slots/bookings/refunds/message endpoints under `owner/`.
- Admin venue review endpoints under `admin/venues/`.
- Public discovery endpoints: `discovery/reference/`, `venues/`, `venues/{id}/`, `courts/`, `courts/{id}/`, `courts/{id}/slots/`.
- Player booking endpoints: `bookings/reserve/`, `bookings/my/`, `bookings/{id}/`, `bookings/{id}/cancel/`, `bookings/{id}/khalti/initiate/`, `bookings/{id}/khalti/verify/`.

Notifications: `/api/notifications/`

- list, unseen count, mark seen, mark read, mark all read, mark related read, action.

Wishlist: `/api/wishlist/`

- list, summary, toggle, delete.

No Swagger/OpenAPI documentation is present.

## 19. Testing

Existing backend tests:

- `backend/accounts/tests.py`
- `backend/teams/tests.py`
- `backend/venues/tests.py`
- `backend/notifications/tests.py`
- `backend/wishlists/tests.py`

Run tests:

```powershell
cd backend
python manage.py test accounts teams venues notifications wishlists --keepdb
```

Run checks/build:

```powershell
cd backend
python manage.py check
```

```powershell
cd frontend
npm run build
```

No frontend test runner is configured.

Recommended next tests: permissions, email reset edge cases, concurrent reservations, Khalti status mapping, cancellation tiers, refund transitions, notification seen/read security, and discovery zero-result filters.

## 20. Known Issues and Limitations

- Open games, challenge teams, Game Room, ratings, disputes, and recommendations are not implemented.
- Several placeholder pages still exist for future modules.
- Future-compatible Futsal fields remain in `PlayerProfile`, but current UI must stay Cricksal-only.
- No production deployment files, Docker config, CI/CD, or monitoring.
- No frontend tests.
- Khalti requires environment credentials and manual end-to-end verification.
- Media files are local and not production-secure.
- Verification documents need private access control before production.
- Owner offline booking is not complete.
- Mobile discovery filters are not fully staged.
- No formal architecture, ERD, use-case, API, or test documentation files exist.

## 21. Security Notes

Verified practices:

- Django password hashing.
- Email uniqueness.
- Public admin registration blocked.
- Email verification required before login/protected access.
- OTPs stored as hashes.
- Password reset tokens stored as digests.
- Password reset tokens expire after 15 minutes and are single-use.
- Password reset requires matching account email.
- Password reset increments `auth_version`.
- Verified JWT auth checks user verification and auth version.
- Role-based permissions on main APIs.
- Booking reservation uses transaction locking.
- Khalti secret is environment-based.
- `.env` and `.env.local` are gitignored.

Remaining risks:

- Tokens are stored client-side for development convenience.
- No API rate limiting.
- No full audit logging.
- No production file scanning/private media storage.
- Local CORS/allowed-host settings only.
- No production monitoring.

## 22. Deployment Status

Current status: local development only.

No staging or production deployment configuration was found.

Production checklist:

- Set `DEBUG=False`, secure `SECRET_KEY`, `ALLOWED_HOSTS`, and CORS.
- Configure production PostgreSQL.
- Configure HTTPS.
- Configure SMTP.
- Configure Khalti production credentials when ready.
- Move media/static handling to production-ready storage.
- Protect verification documents.
- Schedule booking maintenance commands.
- Add logging, backups, monitoring, CI/CD, and deployment docs.

## 23. Documentation and Diagrams

Found documentation:

- `README.md`
- `.env.example`
- `frontend/.env.local.example`

Found visual assets:

- `frontend/public/images/logo.png`
- `frontend/public/images/sportspot-logo.png`
- `frontend/public/images/sportspot-mark.png`
- `frontend/public/images/sportspot-auth-cricksal.png`

No architecture diagram, ER diagram, use-case diagram, API documentation, report document, or testing document was found.

## 24. Handover Guide for the Next Developer or AI Assistant

Current branch: `main`.

Most recently developed areas:

- Court discovery filters and venue card UX.
- Wishlist integration.
- Booking lifecycle, cancellation, refunds, Khalti flow.
- Notifications and toast feedback.
- Email verification and password recovery.

Inspect these first before changing major flows:

- `backend/sportspot_api/settings.py`
- `backend/sportspot_api/urls.py`
- `backend/accounts/security.py`
- `backend/accounts/serializers.py`
- `backend/players/models.py`
- `backend/teams/views.py`
- `backend/venues/models.py`
- `backend/venues/views.py`
- `backend/venues/policies.py`
- `backend/venues/services.py`
- `backend/venues/reference_data.py`
- `backend/venues/khalti.py`
- `backend/notifications/services.py`
- `backend/notifications/email_service.py`
- `frontend/components/Navbar.tsx`
- `frontend/components/NotificationCenter.tsx`
- `frontend/components/ToastProvider.tsx`
- `frontend/app/courts/page.tsx`
- `frontend/app/courts/[id]/page.tsx`
- `frontend/app/dashboard/owner/venue-setup/page.tsx`
- `frontend/app/dashboard/player/bookings/payment/[bookingId]/page.tsx`

Current blockers:

- SMTP and Khalti secrets must be configured locally.
- Production deployment is not designed.
- Future modules need new models/APIs.

Before implementing a feature, verify its current frontend, backend, database and permission status. Do not assume that a visible page means the feature is complete.

Recommended next task: complete booking flow QA end-to-end with real local SMTP and Khalti development credentials, then add missing tests for reservation, cancellation, refund, notifications, and email delivery.

Commands before new work:

```powershell
git status --short
cd backend
python manage.py check
python manage.py test accounts teams venues notifications wishlists --keepdb
cd ..\frontend
npm run build
```

## 25. Git Workflow

```powershell
git status --short
git checkout -b feature/short-feature-name
git add -A
git commit -m "Describe the completed feature or fix"
git push origin feature/short-feature-name
```

Do not commit `.env`, `.env.local`, `node_modules/`, `.next/`, `.venv/`, uploaded media, passwords, App Passwords, OTPs, Khalti keys, JWT secrets, or database credentials.

## 26. License or Academic Use

No open-source license file is currently present.

SportSpot is currently intended for academic or private development use. No open-source licence has been assigned.
