# SportSpot

SportSpot is a Nepal-focused sports web application for Cricksal players, teams, court owners, and administrators.

Current development status: active local development. Authentication, email verification, password recovery, player profiles, player dashboard shell and core dashboard pages, teams, invitations, venue onboarding, admin venue review, court discovery, multi-slot booking, Khalti payment verification, notifications, transactional emails, owner refund actions, wishlist support, Pickup Game matchmaking, Fill My Squad temporary-player recruitment, structured Planning/Game/Squad Rooms, booking-payment reconciliation, request lifecycle history, automatic platform maintenance, shared player participation commitments with host attendance review and player dispute protection, a dedicated Venue Manager workspace shell with top bar, sidebar, Overview, and Calendar, authenticated user-scoped WebSocket notification delivery, and a partially complete Team Challenge workflow with discovery, direct/open proposals, multiple open-team responses, opponent selection, counter-proposals, acceptance, booking handoff, notifications, expiry maintenance, rescheduling/reconfirmation, and protected fixture-room coordination exist in the repository. Broader abuse/report moderation, staff dispute tooling, production deployment, Redis provisioning for shared push delivery, owner offline booking, exhaustive concurrency testing, and several admin operations are not complete.

Last repository verification: 2026-08-30. The latest checked branch is `main`.

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
- Team-based open games beyond Pickup Game.
- General disputes, appeals, and abuse moderation for games and team challenges. Attendance disputes now have a bounded player review flow and protected staff resolution endpoint, while a broader case-management console remains future work.
- Full chat-based Game Room.
- Rating submission and recommendation engine.
- Production deployment and monitoring.

## 3. User Roles and Permissions

| Role | Purpose | Verified capabilities | Restrictions |
| --- | --- | --- | --- |
| Guest | Public visitor | View homepage and public court discovery, register, log in, request password reset | Cannot book, save wishlist, manage teams, or access dashboards |
| Player | Cricksal participant | Verify email, log in, use the Player Dashboard, maintain profile, upload profile photo, create teams, invite by SportSpot ID, add guests, accept/reject invitations, view member profile cards, save wishlist items, discover venues, reserve consecutive slots, pay with Khalti, view bookings, cancel eligible bookings, receive notifications, and use the available Team Challenge discovery and captain-authorized proposal actions | Cannot manage venues, slots, owner refunds, or admin review |
| Court Owner | Venue operator | Verify email, use the Venue Manager workspace, set up venue, upload photos/proof, submit for review, manage own courts, generate/block/unblock slots, view operational calendar, view bookings, view venue reports, cancel own bookings, send booking messages, process owner-side refund records | Cannot create player teams or approve venues |
| Admin | Internal reviewer | Django admin access, frontend admin dashboard, venue approval/request-changes/rejection/suspension | Public registration is blocked; full users/bookings/reports/disputes admin is incomplete |

## 4. Technology Stack

| Layer | Technology | Purpose | Why selected |
| --- | --- | --- | --- |
| Frontend | Next.js 15, React 19 | App Router UI | Modern React routing and rendering |
| Frontend | TypeScript | Typed UI and API contracts | Reduces integration mistakes |
| Frontend | Tailwind CSS | Responsive styling | Fast consistent UI system |
| Frontend HTTP | Axios | API calls | JWT interceptor support |
| Frontend maps | Leaflet and React Leaflet | Interactive venue maps and owner pin selection | Works with a configurable tile provider and keeps map rendering client-only |
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
- Application/API: Django apps in `backend/accounts`, `players`, `teams`, `venues`, `matchmaking`, `team_challenges`, `notifications`, `wishlists`.
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
│   ├── matchmaking/        # Pickup Game and Fill My Squad recruitment
│   ├── team_challenges/    # Team challenges, proposals, responses, fixtures
│   ├── notifications/      # Notification Centre and email delivery
│   └── wishlists/          # Player saved venues/courts
├── frontend/
│   ├── app/                # Next.js routes
│   ├── components/         # Navbar, dashboard shell, Notification Centre, modals, toasts
│   │   ├── owner/          # Venue Manager top bar, sidebar, dashboard shell, location picker
│   │   └── venue/          # Public venue map components
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

### Frontend Navigation and Dashboards

| Feature | Status | Evidence | Remaining work |
| --- | --- | --- | --- |
| Global public/player navbar | Completed | `frontend/components/Navbar.tsx` | Continue route-level polish |
| Shared SportSpot visual language | Partially completed | `frontend/app/globals.css`, `BackButton`, dashboard/owner page-header and feedback primitives | Continue migrating older admin, owner destination and complex form surfaces without changing their workflows |
| Player Dashboard shell/sidebar | Completed | `frontend/components/player-dashboard/`, `/dashboard/player/*` | Detailed content can continue per section |
| Player Dashboard Overview | Completed | `/dashboard/player/page.tsx` | Broader backend aggregation later |
| Player My Profile page | Completed | `/dashboard/player/profile` | Public profile route polish |
| Player My Teams page | Completed | `/dashboard/player/teams` | Team discovery later |
| Player My Games page | Partially completed | `/dashboard/player/games` | Pickup/Fill My Squad activity is connected; broader Team Challenge presentation and end-to-end coverage remain |
| Player My Bookings page | Completed | `/dashboard/player/bookings` | More cancellation/refund QA |
| Ratings & Reliability page | Partially completed | `/dashboard/player/ratings` | Shared participation commitments, verified attendance outcomes, bounded no-show review, fixture-based rating eligibility, and reliability metrics exist; broader rating and adjudication coverage remains |
| Player Settings page | Completed | `/dashboard/player/settings` | Dual-role/account-mode support later |
| Venue Owner Settings page | Completed | `/dashboard/owner/settings` | Staff accounts and automated payouts are not in the current domain |
| Player Wishlist access | Completed | `/dashboard/player/wishlist`, Player navbar link | Expand saved-item types later |
| Venue Manager shell/sidebar/top bar | Completed | `frontend/components/owner/*`, `/dashboard/owner/*` | Continue workflow expansion without fragmenting the shared owner visual system |

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
| Reliability display | Partially completed | `ParticipationCommitment`, attendance services, fixture/game rooms, ratings page | Staff-facing dispute resolution, broader rating coverage, and moderation remain |
| Ratings | Partially completed | `PlayerRating`, eligibility service, `/api/players/ratings/eligibilities/{id}/submit/` | Broader UI, moderation and cross-match coverage remain |

### Team Management

| Feature | Status | Evidence | Remaining work |
| --- | --- | --- | --- |
| Create team | Completed | `TeamCreateView`, redesigned `/dashboard/player/teams/create` | More backend validation and optional naming rules |
| Captain membership | Completed | creator added as CAPTAIN | Role transfer not implemented |
| Team photo | Completed | `team_photo` | Image size policy |
| Invite by SportSpot ID | Completed | `/api/teams/players/lookup/`, `/invite/` | Optional invitation expiry |
| Accept/reject invitation | Completed | `/api/teams/invitations/` | None known |
| Guest player | Completed | `/members/guest/` | Extended guest lifecycle |
| Remove member/invitation | Completed | status-based removal | Soft history improvements |
| Public team browsing | Partially completed | `/api/team-challenges/teams/`, `/challenge-teams` | Requires broader team discovery and moderation rules |

### Open Games

| Feature | Status | Evidence | Remaining work |
| --- | --- | --- | --- |
| Find Game page | Partially completed | `frontend/app/find-game/page.tsx`, `backend/matchmaking/` | Expand discovery coverage, pagination, and end-to-end browser tests |
| Pickup Game creation | Partially completed | `Game`, `GameListCreateView`, `/dashboard/player/games/create` | Broaden UX coverage and high-concurrency verification |
| Fill My Squad creation | Partially completed | `Game.game_type`, team captain validation, booking-first/plan-first flow | Continue operational polish and deeper end-to-end coverage |
| Join requests and host decisions | Partially completed | `GameJoinRequest`, request decision/withdraw APIs, waitlist and request history | Broaden concurrency, notification, and browser-flow tests |
| Guests and registered-player invitations | Partially completed | Guest participant and SportSpot ID invitation APIs | Continue lifecycle and post-game invitation coverage |
| Planning Room/Game Room | Partially completed | `/games/{game_id}/room/`, participant access rules | Richer room activity and future real-time collaboration |

### Team Challenges

| Feature | Status | Evidence | Remaining work |
| --- | --- | --- | --- |
| Challenge discovery and team selection | Partially completed | `/challenge-teams`, `/api/team-challenges/teams/`, `/api/team-challenges/challenges/public/` | Broaden filters and end-to-end UX coverage |
| Direct and open challenge creation | Partially completed | `/challenge-teams/create`, `TeamChallenge`, `ChallengeProposal` | Complete production UX and broader validation coverage |
| Multiple open-team responses and opponent selection | Partially completed | `OpenChallengeResponse`, `open-response/`, `select-opponent/` | Add richer browser and concurrency coverage |
| Accept, counter, decline and withdraw | Partially completed | challenge detail actions, immutable proposals, and service layer | Add more concurrency and browser-flow tests |
| Booking-first and plan-first challenge lifecycle | Partially completed | `attach-booking/`, `reschedule/`, `reconfirm/`, `TeamFixture`, booking synchronisation service | Broaden browser/concurrency coverage and finalize dispute policy |
| Challenge notifications and deadline expiry | Partially completed | `team_challenges/notifications.py`, captain-continuity synchroniser, `expire_team_challenges`, unified maintenance | Configure scheduled maintenance and expand notification coverage |
| Challenge fixture/Game Room | Partially completed | `/challenges/{id}/room/`, lineup, attendance, player dispute review, result submit/confirm, participant permissions, rating eligibility | Add staff dispute tooling, richer activity, and broader end-to-end coverage |

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
| Venue Manager Overview | Completed | `/dashboard/owner`, `/api/venues/owner/overview/` | More operational polish and tests |
| Dedicated owner top bar/sidebar | Completed | `VenueOwnerTopBar`, `VenueOwnerSidebar`, `/api/venues/owner/venue/` | Destination pages still need full build-out |
| Venue setup wizard | Completed | `/dashboard/owner/venue-setup` | More validation polish |
| Canonical venue coordinates | Completed | `Venue.latitude`, `Venue.longitude`, migration `0016`, owner venue API | Existing venues may still need an owner-confirmed pin |
| Owner location picker | Completed | `VenueLocationPicker`, owner location search/reverse endpoints | Production deployments should use a managed geocoding provider |
| Public venue map and directions | Completed | `VenueMap`, public venue details, booking directions | Discovery map view and distance sorting remain future work |
| Draft and submit | Completed | `OwnerVenueView`, `OwnerVenueSubmitView` | None known |
| Photos/proof upload | Completed | `VenuePhoto`, document fields, upload APIs | Production private storage |
| Admin status handling | Completed | DRAFT/PENDING/NEEDS_CHANGES/APPROVED/REJECTED/SUSPENDED | Audit logs later |
| Court management | Completed | owner court APIs/pages | Reactivation unclear |
| Slot generation/pricing | Completed | `GenerateSlotsView`, owner setup and court slot screens | Explicit 1-90 day publishing window, weekday recurrence, idempotent regeneration, past-time validation, and overlap protection are implemented; persistent rolling schedule automation and peak pricing are not |
| Block/unblock slots | Completed | `SlotStatusView`, block metadata on `CourtSlot` | Court-closure model can be added later |
| Owner operations calendar | Completed | `/dashboard/owner/calendar`, `/api/venues/owner/calendar/`, `/api/venues/owner/calendar/block/` | Manual booking creation not implemented |
| Venue owner reports | Partially completed | `/dashboard/owner/reports`, `/api/venues/owner/reports/`, bounded custom periods, CSV export | Comparison periods, forecasting, and richer staff analytics later |
| Payment and refund operations | Completed | `/dashboard/owner/refunds`, `/api/venues/owner/refunds/` | Automated money transfer and gateway reconciliation remain future work |
| Offline booking | Planned | navigation concept but no complete model/API | Build owner offline booking flow |

### Booking

| Feature | Status | Evidence | Remaining work |
| --- | --- | --- | --- |
| Select court/date/slots | Completed | `/courts/[id]` | UX polish |
| Multi-slot reservation | Completed | `BookingSlot`, `slot_ids` | More edge-case tests |
| 10-minute hold | Completed | `reserved_until` | Unified maintenance command is available; schedule it in deployment |
| Double-booking prevention | Completed | transactions and `select_for_update` | Load testing later |
| Past-time blocking | Completed | `is_past`, backend validation | Timezone verification in deployment |
| Khalti initiation | Completed | `KhaltiPaymentInitiateView` | Requires valid env key |
| Khalti verification | Completed | lookup before confirmation | Needs live sandbox end-to-end verification |
| Booking pass/history | Completed | player booking pages | Print/download later |
| Booking QR and venue check-in | Completed | `BookingCheckIn`, `BookingVerificationPanel`, `OwnerBookingVerifyView` | Camera/browser QA and operational owner training |
| Cancellation | Completed | `BookingCancelView`, `policies.py` | More tests for all tiers |
| Owner refund actions | Completed | owner refund APIs/page | Real money transfer not implemented |
| Expiry/completion commands | Completed | `expire_reservations`, `complete_bookings`, `run_booking_maintenance`, `run_sportspot_maintenance` | Configure the unified one-shot scheduler/worker in deployment |

### Notifications and Feedback

| Feature | Status | Evidence | Remaining work |
| --- | --- | --- | --- |
| Notification Centre | Completed for connected modules | `notifications` app, `NotificationCenter.tsx` | Connect future modules later |
| Seen/read behaviour | Completed | model timestamps and IntersectionObserver | Accessibility testing |
| Bell badge and push delivery | Partially completed | Navbar/owner bar, `NotificationConsumer`, Redis-ready channel layer, polling fallback | Configure Redis and ASGI deployment for shared multi-worker delivery; add entity-specific push invalidation |
| Notification actions | Partially completed | team invites, matchmaking events and Team Challenge notifications | Broaden challenge and join-request action links |
| Transactional emails | Completed for connected modules | `email_service.py`, templates, `EmailDelivery` | Configure SMTP |
| Global toast system | Completed | `ToastProvider`, `emitToast`; newer dashboard actions use global toasts | Some persistent page errors remain intentionally inline |

### Administration

| Feature | Status | Evidence | Remaining work |
| --- | --- | --- | --- |
| Django admin | Completed | app admin files | Production hardening |
| Frontend admin dashboard | Partially completed | `/dashboard/admin` | More metrics/actions |
| Venue review | Completed | `/dashboard/admin/venues` and admin review API | Audit log |
| User management | Planned | no dedicated page | Build moderation UI |
| Booking oversight | Partially completed | backend permission logic exists | frontend admin booking page missing |
| Admin reports/disputes | Planned | no staff reporting/case-management page | Build later |

### Testing and Deployment

| Feature | Status | Evidence | Remaining work |
| --- | --- | --- | --- |
| Backend tests | Partially completed | tests in accounts, teams, venues, notifications, wishlists, matchmaking, and team challenges; latest verified run: 150 tests | Add deeper concurrency, payment, and cross-module workflow coverage |
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
- Player Dashboard shell with Overview, My Profile, My Teams, My Games, My Bookings, Ratings & Reliability, Settings, and Help & Support navigation.
- My Teams includes an accessible, unclipped actions menu for captain and member team actions, with consistent dashboard menu semantics and responsive stacking.
- Player Settings page with horizontal sections, explicit Account edit/cancel mode, safer email-change verification, separate password updates, notification/privacy preferences, and account deactivation.
- Venue Owner Settings page with focused Account, Security, owner-relevant Notifications, and Venue Operations sections. Owner account edits use the shared email-verification flow; booking/refund alerts are persisted through owner-specific settings endpoints; venue profile, courts, pricing, calendar, refunds, and reports remain linked to their operational workspaces.
- Team creation, redesigned Create Team page, captain permissions, registered invitation by SportSpot ID, guest players, member cards, and invitation decisions.
- Court owner venue setup, photo gallery, verification document upload, admin review, court setup, explicit date-range slot generation, slot blocking, Venue Manager shell/sidebar, Overview, and operational Calendar with compact booking blocks. Venue & Courts now use a consistent owner inventory workspace: venue readiness, location, policy, photos, and court records are separated into scannable sections; owners can replace/remove legacy venue photos and edit/remove court photos without touching bookings or slots.
- Venue-first public discovery with stable backend filter reference data.
- Consecutive multi-slot booking, 10-minute holds, Khalti payment verification, booking pass/history, cancellation, and owner-managed refund records.
- Real signed booking QR passes with booking-code fallback, venue-owner verification, a two-hour pre/post check-in window, idempotent check-in records, and strict separation from player attendance and reliability.
- My Bookings uses a compact responsive reservation workspace with persistent List and three-column Cards views, fixed venue thumbnails, scannable booking metadata, clear payment/status hierarchy, and preserved pass, payment, directions, cancellation, and book-again actions.
- Shared responsive SiteFooter added to the application shell with real player, venue-owner, and support routes; authentication screens remain focused without global navigation chrome.
- Central Notification Centre and global toast feedback.
- Transactional email service with delivery audit table.
- Player wishlist for venues/courts, exposed from the logged-in Player top navbar.
- Dedicated Venue Manager navigation for `/dashboard/owner/*`, including top bar, stable lifecycle-aware sidebar, venue identity/status, contextual venue actions, owner notifications, profile dropdown, and responsive mobile drawer.
- Shared UI refinement pass: compact page headers, cards, controls, field states, empty/error states, fixed feedback toasts, route-aware back links, focus states, reduced-motion support, and smoother active navigation were applied across the main player, owner, discovery, booking, matchmaking, challenge and authentication surfaces. The Venue Manager workspace now has a scoped visual system for its shell, operational panels, KPI links, forms, empty states, and action paths without changing owner APIs or workflows. Remaining older screens are tracked as migration work rather than being presented as complete.
- Venue Manager Bookings now uses compact, individually bounded responsive records with filter counts, avatar/code identity, court and schedule hierarchy, readable status tones, NPR totals, check-in context, and preserved message/cancel actions.
- Team Challenge lifecycle hardening: active-captain continuity, retry-safe decisions and booking attachment, booking reuse prevention, immutable proposal-version rescheduling, participant reconfirmation deadlines, protected fixture-room access, captain-managed lineups, attendance recording, two-captain result submission/confirmation, and verified rating-eligibility creation after attended fixtures.
- Shared mutation throttling for authenticated state-changing matchmaking and challenge endpoints; safe methods remain unthrottled so browsing and read-only detail pages are not slowed by the abuse-control limit.

## 9. Partially Completed and In-Progress Work

- Ratings/reliability use a shared `ParticipationCommitment` ledger for confirmed Pickup Games, Fill My Squad games, and Team fixtures. Hosts/captains record attendance after completion; no-show reports remain neutral for 24 hours so the affected player can dispute them, and only finalized outcomes affect reliability. Broader player-rating coverage and staff case-management tooling remain incomplete.
- Team Challenges now have a real backend domain, migrations, discovery/create/detail screens, direct and open challenge paths, multiple open responses with creator-controlled opponent selection, immutable proposals, captain-only decisions, booking-first and plan-first states, booking ownership/status/time validation, retry-safe lifecycle actions, proposal-version rescheduling, explicit captain reconfirmation, linked-booking lifecycle synchronisation, automatic deadline expiry, active-captain continuity, and a protected fixture Game Room with lineup, shared attendance review, and result controls. Remaining work includes staff dispute tooling, richer room activity, broader end-to-end/concurrency coverage, and production scheduler configuration.
- Pickup Game has a structured Planning Room/Game Room; live chat and reusable rooms for future challenge flows are not implemented.
- Admin venue review works, but broader admin operations are incomplete.
- Owner offline booking is not implemented as a full feature.
- Venue Manager top bar, sidebar, mobile drawer, Overview, Calendar, venue/court pages, bookings, refunds, slot management, and Reports now share a scoped operational visual system. Availability & Pricing loads the owner venue and court inventory, summarizes active/publishing readiness, and provides direct slot and calendar actions. Reports load server-calculated booking, payment, refund, check-in, slot, utilization, daily activity, and per-court performance records; owners can switch the activity view between reservations and paid value and export the loaded report as CSV. Settings clearly exposes its current workflow boundaries. Comparison analytics remain tracked separately.
- The UI migration is intentionally incremental. The shared tokens and primitives are in place, but older admin pages and a few complex owner forms still contain local styling that should be migrated after their workflows are verified.
- Slot publishing accepts an explicit date range of up to 90 days and is intentionally add-only: it preserves existing/booked slots and rejects overlapping schedules. Owners can clear a selected future date range per court, but only future unbooked slots are removed; booked, reserved, blocked, past, and historical slots are protected. Past slots remain visible to owners as history but are not bookable or editable. Automatic rolling extension and bulk all-court schedule replacement are not implemented yet.
- Dual-role account switching is not supported by the current backend user model, so “Switch to Player Mode” is intentionally hidden.
- Khalti needs environment configuration and real end-to-end verification after credentials are added.
- Media handling is local-development only.
- Frontend lacks automated tests.

## 10. Remaining Features and Prioritized Roadmap

### Priority 0 - Critical correctness and security

| Objective | Current status | Main tasks | Dependencies | Completion criteria |
| --- | --- | --- | --- | --- |
| Verify Khalti end-to-end | Needs verification | Configure env, reserve booking, pay, verify lookup | Khalti credentials | Confirmation only after verified payment |
| Harden secrets | Partially completed | Review env, docs, frontend bundle | None | No secrets in git or user-facing screens |
| Expand booking and matchmaking race tests | Partially completed | Add concurrent reservation, final-spot, challenge-decision, and booking-attachment tests | Booking, matchmaking and Team Challenge services | Concurrent requests cannot create duplicate commitments or conflicting decisions |
| Run lifecycle maintenance in deployment | Partially completed | Schedule `run_sportspot_maintenance --limit 100` every minute through managed infrastructure | Deployment platform and PostgreSQL | Expiry, completion, reminders, reconciliation, and host/challenge continuity run without page visits |
| Secure proof documents | Planned | Protected file access or private storage | Deployment/storage choice | Only owner/admin can access proof files |
| Production recovery policy | Partially completed | Set neutral disclosure in prod | Env config | Unknown emails are not exposed |

### Priority 1 - Complete core MVP

| Objective | Current status | Main tasks | Dependencies | Completion criteria |
| --- | --- | --- | --- | --- |
| Finish booking UX QA | In progress | Test reservation, payment, cancellation, refund, notifications | Existing booking flow | Smooth player/owner booking lifecycle |
| Complete owner operations | Partially completed | Build offline booking, refine owner destination pages, add deeper tests for calendar blocking/conflicts | Venue/court slots | Owner can protect offline bookings and use a polished management workspace |
| Admin operations | Partially completed | Users/bookings/refund overview | Permissions | Admin can review operational risks |
| Pickup Game and Fill My Squad matchmaking | Partially completed | Add pagination, deeper high-concurrency tests, richer room activity, and broader end-to-end coverage | Booking, player profile, teams, notifications | Booking-first and plan-first flows work with backend deadline validation, controlled area options, role-based recruitment, skill/time/open-spot/waitlist discovery filters, transactional join-request creation, duplicate-invitation protection, invitation expiry, immutable request-event history, contiguous waitlist positions, guest participants, SportSpot ID invitations, participant-specific reconfirmation, quiet detail-page refreshes, payment handoff reconciliation, automatic maintenance, and structured least-privilege room access. Public and planning-room payloads omit registered-player account and trust details. |
| Team challenges | Partially completed | Real challenge models/API, discovery/create/detail UI, multiple open responses with one selected opponent, proposal decisions, booking handoff, rescheduling/reconfirmation, notifications, expiry maintenance, and protected fixture-room controls | Team module, booking rules, fixture records | Captains can safely discover, create, respond to, counter, accept, withdraw, cancel, reschedule and reconfirm challenges; selected fixtures support lineup, attendance and two-captain result confirmation; disputes and broader concurrency coverage remain |

### Priority 2 - Operational completeness

| Objective | Current status | Main tasks | Dependencies | Completion criteria |
| --- | --- | --- | --- | --- |
| Ratings/reliability | Partially completed | Complete broader player-rating coverage, staff moderation, and dispute handling | Completed games and verified participants | Verified participant ratings and reliability events consistently affect trust displays |
| Game Room expansion | Partially completed | Add richer announcement/history features and future live chat if needed | Pickup Game and team fixtures | Pickup and confirmed team fixtures have least-privilege room access; richer collaboration remains |
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
2. Player opens `/dashboard/player/teams/create`.
3. Player fills the redesigned Create Team form, optionally uploads a team photo, and submits.
4. Backend creates the team and makes the creator captain.
5. Frontend redirects to the team detail page.
6. Captain looks up a player by SportSpot ID from the team detail flow.
7. Captain sends invitation.
8. Invited player accepts or rejects.
9. Accepted player becomes active member.

### Open-game join request

Status: Partially completed. Players can browse real Pickup Game and Fill My Squad listings, submit role-aware join requests, and withdraw them. Authorised hosts can accept, reject, or waitlist applicants, add guests, invite registered players by SportSpot ID, and manage the roster. Remaining work is broader browser-flow, concurrency, and pagination coverage.

### Team challenge

Status: Partially completed. Captains can discover teams, create direct or open challenges, publish booking-first or plan-first proposals, receive multiple responses to an open challenge, select one opponent, respond through captain-only actions, counter a plan, attach an eligible booking from either participating captain, reschedule through a new proposal version, reconfirm changed schedules, and receive challenge notifications. Accepted challenges expose a protected fixture Game Room with captain-managed lineup, shared attendance review, result submission/confirmation, and verified rating-eligibility creation for attended participants. The backend rejects duplicate active team pairings and booking reuse, synchronizes linked booking lifecycle changes, transfers or closes unmanaged challenges after captain changes, and expires due records through maintenance. Remaining work includes staff dispute tooling, richer room activity, broader end-to-end/concurrency coverage, and production scheduler configuration.

Challenge proposals carry the complete agreed plan: match date, start and end time, district, area, and optional preferred venue. A booking can be attached only when it matches that accepted plan. If either captain needs to change the location or schedule, they must send a new counter-proposal; both captains must accept the new proposal before a matching paid booking can be attached. The challenge screens use dependent district/area fields and separate date and friendly time controls so location changes are not hidden in a message.

### Player settings

1. Player opens `/dashboard/player/settings` or `/dashboard/settings` redirect.
2. Settings sections are controlled through URL query state such as `?section=account`.
3. Account details are read-only by default.
4. Player clicks `Edit Account` to change full name, phone, or email.
5. Cancel restores the last saved values.
6. Changing email requires the current password and starts OTP verification for the new address.
7. Security, notification, privacy, and account-management actions remain separate.

### Venue owner settings

1. Court Owner opens `/dashboard/owner/settings` and receives only owner-account settings.
2. Account allows the owner to edit full name, phone, or email. An email change requires the current password and starts OTP verification; the existing email stays active until verification succeeds.
3. Security uses the shared password-change flow and signs the owner out after a successful password change so existing sessions cannot remain active.
4. Notifications expose only booking activity, cancellations/refunds, and supported email delivery because those are the owner-relevant alert domains currently connected to the notification service.
5. Venue Operations is a navigation section, not a duplicate form. It links to Venue & Courts, Courts/slot management, Calendar, Payments & Refunds, and Reports so changes remain scoped and auditable.
6. Player-only privacy, team, rating, and reliability settings are intentionally absent. Staff roles, payout accounts, and owner account deletion require separate backend domains before they should appear in this workspace.

### Venue owner top navigation

1. Court Owner opens any `/dashboard/owner/*` route.
2. `AppChrome` renders `VenueOwnerTopBar` instead of the public/player navbar.
3. Top bar fetches `/api/venues/owner/venue/` once for the owner workspace and keeps the venue identity stable while navigating.
4. If no venue exists, it shows `Setup Incomplete` with no fake venue name.
5. If a venue exists, it shows the real venue name and status label.
6. Contextual actions change by status: preview, review feedback, view public venue, or support.
7. Owner notification bell uses the existing Notification Centre for the authenticated owner account.
8. Owner profile dropdown provides owner profile/account entry points, support, and logout.

### Venue Manager shell and sidebar

1. Court Owner routes under `/dashboard/owner/*` use `VenueOwnerDashboardLayout`.
2. Desktop shows a persistent lifecycle-aware sidebar; mobile uses an accessible drawer opened from the owner top bar menu button.
3. Approved/active venues show Overview, Calendar, Bookings, Venue & Courts, Availability & Pricing, Payments & Refunds, Reports, Settings, and Help & Support.
4. No-venue, setup, pending, changes-required, suspended, and inactive states show reduced navigation appropriate to that lifecycle.
5. Sidebar active state is route-derived and remains stable during navigation; venue data is not refetched on every sidebar click to avoid visual flicker.

### Venue Manager calendar

1. Owner opens `/dashboard/owner/calendar`.
2. Frontend requests `/api/venues/owner/calendar/?date=YYYY-MM-DD&view=day|week`.
3. Backend returns the owner venue, courts, generated slots, operational bookings, blocked periods, calendar stats, and server time.
4. Day view displays time vertically and courts as columns; week view groups real bookings and blocked periods by day. Compact booking blocks truncate safely so status, player, time, and code do not overlap.
5. Clicking a booking opens an owner-safe booking details drawer.
6. `Block Court Time` posts to `/api/venues/owner/calendar/block/` and blocks overlapping generated available slots.
7. If selected time overlaps reserved or booked slots, the API returns a conflict warning and does not hide customer bookings.
8. Block metadata is stored on `CourtSlot`; public venue discovery serializers must not expose slot-only block fields on venue records.

### Venue Manager reports

1. Owner opens `/dashboard/owner/reports` and chooses a 7, 30, or 90-day preset, or selects a custom inclusive date range of up to 365 days.
2. Presets use `/api/venues/owner/reports/?period=7|30|90`; custom ranges use `/api/venues/owner/reports/?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`. The backend limits the response to the authenticated owner&apos;s venue and rejects malformed, reversed, future, or over-long ranges.
3. The report summarizes reservations, confirmed/completed outcomes, paid booking value, processed and pending refunds, venue check-ins, published/booked/reserved/blocked slots, and slot utilization.
4. Court performance is calculated per physical court so owners can compare booking count, paid value, check-ins, published capacity, and utilization before opening that court&apos;s slot manager.
5. Activity bars group the server-provided daily trend into up to 14 readable periods; they are a compact visualization of source records, not a forecast.
6. Paid booking value includes only confirmed or completed bookings with a recorded `PAID` status. Utilization is booked slots divided by published slots (`AVAILABLE`, `RESERVED`, and `BOOKED`); blocked and cancelled slots are excluded.
7. The report is read-only. Owners can export the loaded summary, daily activity, and court performance as CSV. They use Bookings, Payments & Refunds, Calendar, and Court Slots for operational changes. Comparison periods, forecasting, and staff dispute analytics remain future work.

### Venue Manager payments and refunds

1. Owner opens `/dashboard/owner/refunds`; the page requests refund-eligible cancelled bookings scoped to the authenticated owner's venue.
2. The default queue shows only `PENDING_OWNER_ACTION` records because that is the only state requiring an owner decision.
3. Each record is a separate bounded card with an explicit player and booking block, a dedicated financial block, and a compact details band for the policy-calculated refund percentage and amount, cancellation reason, payment status, and eligibility explanation.
4. Owners can switch between all records, pending action, refunded, partially refunded, and rejected outcomes without changing the underlying booking state.
5. For a pending record, the owner must enter a processing reference or note of at least three characters and submit `MARK_REFUNDED` to `/api/venues/owner/refunds/{booking_id}/review/`.
6. The API rechecks venue ownership, cancellation state, refund state, and note validity inside a database transaction. It derives full versus partial payment status from the stored entitlement and does not allow the owner to reduce or reject a system-approved refund.
7. The processed record retains the owner's note, reviewing account, and timestamp. The player receives the existing refund-status notification; this MVP records the outcome but does not move money through a payment gateway.

### Pickup Game and Fill My Squad matchmaking

1. Player opens `/dashboard/player/games/create` and chooses either Pickup Game or Fill My Squad.
2. Pickup Game hosts continue as individual organisers; Fill My Squad requires a permanent team captained by the current player.
3. For Fill My Squad, the captain selects participating permanent team members; temporary applicants are never added as permanent members automatically.
4. Booking-first creation uses only the host's future `CONFIRMED` + `PAID` bookings that are not already linked to an active game.
5. Plan-first creation stores proposed date, time, preferred area, optional venue, minimum players, booking deadline, recruitment deadline, role requirements, and waitlist preference without pretending a court is booked.
6. The host occupies one roster spot automatically: confirmed for booking-first games and provisional for plan-first games.
7. Public players browse real Pickup Game and Fill My Squad listings at `/find-game` and open `/find-game/{gameId}`.
8. Players request an available Cricksal role with an optional message and availability confirmation. Active members of the selected Fill My Squad team cannot apply as temporary outside players.
9. Host reviews applicant cards from `/dashboard/player/games` or `/dashboard/player/games/{gameId}` and accepts, rejects, or waitlists requests.
10. Accepted booking-first players become confirmed participants; accepted plan-first players remain provisional until a booking is attached.
11. Guests can be added by name and optional role; each guest occupies a real roster spot but has no account access.
12. Waitlisted players do not count as confirmed and can be promoted manually after capacity, role, skill, and conflict checks.
13. When a plan-first game reaches the minimum threshold, the host uses the guided `Book Court for Game` action. Court discovery receives the game context, the booking reservation stores that context, Khalti payment is verified by the backend, and the confirmed booking is attached to the game automatically.
14. If the verified booking differs materially from the original proposal, each registered participant who was already in the roster must confirm or decline the new schedule without a reliability penalty. Offline guests cannot respond through an account, so they enter `Host Confirmation Required` and the host must confirm that each guest was told the final venue and time. Participants added after the booking is attached are confirmed against the final booking immediately.
15. Host and active participants can access the structured Planning Room/Game Room/Squad Room; pending, rejected, and waitlisted users cannot access private room details.
16. Cancelling the public game listing does not automatically cancel the court booking; booking cancellation and refunds stay in the existing My Bookings flow.
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

### Booking pass and venue check-in

- A real signed QR pass is exposed only to the player who owns a paid booking after it is `CONFIRMED`; unpaid reservations never receive an active pass.
- The pass also shows the human-readable booking code so venue staff can continue when camera permission, lighting, or a desktop browser makes scanning impractical.
- Venue owners use `POST owner/bookings/verify/` from the Venue Manager Bookings page. Verification is authenticated, restricted to the booking's venue owner, and returns only the operational booking summary needed at the desk. Camera scanning prefers the device environment camera, starts after the scanner preview mounts, and explains secure-context, permission, and no-camera failures while preserving the code fallback.
- The check-in window opens two hours before the first slot and closes two hours after the final slot. Cancelled, expired, unpaid, refund-pending, and refunded bookings cannot be checked in.
- Successful check-in is idempotent: repeated scans show the original check-in and increment an audit scan count instead of creating duplicate records. The first successful check-in sends one deduplicated in-app `BOOKING_CHECKED_IN` update to the booking owner; the venue owner is the verifying actor and receives no redundant self-notification.
- A booking QR verifies court access only. It does not mark a Pickup Game, Fill My Squad game, or Team Challenge roster as attended and never changes reliability. Hosts and captains continue to record registered-player attendance through the shared participation-commitment workflow.
- `BookingCheckIn` stores the verified check-in actor and timestamps. The QR token is opaque and signed; it contains no player contact details, payment data, or private profile information.

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
- Khalti initiation is idempotent for an existing booking payment reference.
- Failed payment does not confirm booking.
- Expiry releases unpaid holds.
- A completed Khalti payment is never treated as refund-not-required. If the original slots are still safely held, the booking is confirmed; otherwise the booking enters refund review with payment_status=REFUND_PENDING.
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
- `backend/notifications/consumers.py` exposes an authenticated `/ws/notifications/` stream.
- The browser sends the access token as the first socket message rather than placing it in the URL.
- New notification events are published only after the database transaction commits.
- `frontend/components/NotificationCenter.tsx` uses push invalidation to refresh the existing permission-checked REST data.
- Exponential reconnect, access-token refresh, heartbeat messages, and polling fallback are implemented.
- Without `REDIS_URL`, local single-process development uses Django's in-memory channel layer. Shared staging/production workers require Redis.
- WebSocket delivery does not replace the scheduled maintenance command; maintenance changes expired/completed records, then notifications are pushed.

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
| `REDIS_URL` | Shared Channels channel layer for real-time delivery | Required for multi-worker deployment; optional for single-process local development | `redis://127.0.0.1:6379/1` |
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
| `LOCATION_GEOCODER_URL` | Backend geocoding provider endpoint | Optional | `https://nominatim.openstreetmap.org` |
| `LOCATION_GEOCODER_USER_AGENT` | Identifies backend location requests | Optional | `SportSpot venue location picker` |
| `LOCATION_GEOCODER_TIMEOUT` | Maximum geocoding request time in seconds | Optional | `5` |
| `ACCOUNT_RECOVERY_REVEAL_EMAIL_ERRORS` | Local/demo reset error visibility | Optional | `True` locally, `False` in production |
| `NEXT_PUBLIC_API_URL` | Frontend API URL | Frontend | `http://127.0.0.1:8000` |
| `NEXT_PUBLIC_MAP_TILE_URL` | Browser map tile template | Frontend | `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png` |
| `NEXT_PUBLIC_MAP_ATTRIBUTION` | Map provider attribution shown in the map | Frontend | `&copy; OpenStreetMap contributors` |

Never commit real secrets.

## 16. Local Development Setup

Prerequisites:

- Git.
- Python 3.12 or compatible Python 3 version for Django 5.
- PostgreSQL 17 or compatible PostgreSQL version.
- Redis 6 or compatible Redis version for shared real-time delivery in multi-worker/staging/production deployments. It is optional for a single local process.
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

The frontend development command always targets port `3000`. Its launcher automatically restarts an existing SportSpot Next.js development process on that port, but will not stop an unrelated application. Run `npm run dev` once per terminal session; repeated runs safely restart the same SportSpot watcher instead of falling back to another port.

Local URLs:

- Frontend: `http://localhost:3000`
- Backend: `http://127.0.0.1:8000`
- Django admin: `http://127.0.0.1:8000/admin/`

## 17. Database and Migrations

Database engine: PostgreSQL. Migration `0016` adds canonical venue latitude/longitude coordinates, the location source, confirmation state, and update timestamp. Coordinates are optional for backward compatibility, must be a pair inside Nepal, and public serializers expose them only after the owner confirms the pin. Existing `map_location` URLs remain a backward-compatible directions fallback for older venues.

Main domain tables include accounts, email OTPs, password reset tokens, player profiles, reliability events, participation commitments, player ratings and eligibilities, teams, team members, venues, venue photos, courts, court slots, bookings, booking slots, booking messages, booking check-ins, Pickup Games, matchmaking participants and request history, Team Challenges, challenge proposals, open challenge responses, challenge events, team fixtures, notifications, email deliveries, and wishlist items. Migration `0008` adds the shared participation-commitment ledger used by verified attendance and reliability. Migration `0020` adds the venue-scoped booking check-in record used by QR/code verification. Court slots now also store block metadata (`block_type`, `block_reason`, `block_note`, `blocked_at`, `blocked_by`) for owner calendar maintenance/closure periods.

Migration commands:

```powershell
cd backend
python manage.py makemigrations
python manage.py migrate
```

Lifecycle commands:

```powershell
python manage.py run_sportspot_maintenance
python manage.py run_sportspot_maintenance --no-notify --no-reminders
python manage.py expire_matchmaking --dry-run
```

For near real-time reservation expiry, booking completion, booking-completed notifications, and reminders during local development, use one background option. On Windows, prefer the hidden Task Scheduler registration described below. The watcher command is still available for foreground debugging:

```powershell
.\scripts\run_booking_worker.ps1
```

Equivalent backend command:

```powershell
cd backend
python manage.py run_sportspot_maintenance --watch --interval 10 --reminder-every 300
```

The existing `scripts/run_booking_worker.ps1` now starts this unified worker for compatibility with the previous command name.

In production, schedule the one-shot command every minute through cron, Windows Task Scheduler, or a managed worker:

```text
python manage.py run_sportspot_maintenance --limit 100
```

Each lifecycle transition is state-guarded and performed under record locks, so retries and overlapping one-shot runs are safe. Prefer one managed scheduler/worker rather than multiple permanent watch processes.

### Venue location behavior

- Court Owners search for a venue or address through the backend-only geocoder endpoints, then confirm or adjust the pin on the interactive map.
- Search first uses the owner’s exact query, retries with a Nepal-scoped query, and then falls back to a recognised SportSpot area when a specific local POI is not indexed by the provider. This helps searches such as `Maitidevi petrol pump` resolve to the Maitidevi area while leaving the owner responsible for confirming the exact entrance pin.
- A map click or draggable pin remains usable when reverse address lookup is unavailable; the owner can enter or keep the address manually.
- `Venue.city` stores the canonical SportSpot district and `Venue.area` stores the controlled discovery area. The current supported Kathmandu catalogue includes both `Maitidevi` and `Kageshwori`; these values are shared by venue setup, venue discovery, Pickup Game planning, and Team Challenge proposals.
- The map coordinates (`latitude` and `longitude`) identify the exact public directions point. They do not replace the district/area filters and are not used to invent a new filter area. Recognised geocoder results may prefill the district and area, but the owner can correct them before saving.
- Public venue details, owner venue views, player booking directions, and matchmaking booking summaries use confirmed coordinates when present.
- Older venues continue to work through their saved secure Google Maps link until an owner confirms a canonical pin.
- The default OpenStreetMap tile/geocoding configuration is suitable for local development and light evaluation traffic only. A production deployment must select a provider with an appropriate usage policy, attribution, rate limits, monitoring, and a service agreement.

### Windows automatic local scheduling

On Windows, register the scheduler once from the repository root:

```powershell
.\scripts\register_sportspot_maintenance_task.ps1
```

This creates a current-user Task Scheduler entry that runs the unified lifecycle pass every minute through a windowless Windows Script Host wrapper. It uses the project virtual environment when available, includes the idempotent booking-reminder pass, and writes operational output to `.logs/sportspot-maintenance.log`. Reminder notifications and transactional emails use unique booking keys, so repeated checks do not send duplicates. The task starts automatically when its scheduled trigger is available; the computer and backend database must still be running. It should not open a PowerShell window.

To inspect or remove it:

```powershell
Get-ScheduledTask -TaskName "SportSpot Platform Maintenance"
.\scripts\unregister_sportspot_maintenance_task.ps1
```

This is a local Windows convenience. Staging and production should run the same one-shot command through a managed scheduler, container job, cron entry, or worker process. Do not run both the foreground watch worker and the scheduled task against the same environment. The watch worker intentionally stays attached to a terminal for debugging; it is not the production-style background option.

No verified seed-data command or ER diagram is present.

Lifecycle scheduling limitation: the repository provides idempotent maintenance,
request-time lifecycle safeguards, a local watch worker, and Windows registration
scripts. It does not install a cloud production scheduler; staging and production
must run the one-shot command through their managed infrastructure.

Matchmaking expiry is part of the same platform maintenance pass. It:

- closes recruitment when the recruitment deadline passes;
- cancels an unbooked Plan First game when its court-booking deadline passes;
- moves games to In Progress or Completed from their real start/end timestamps;
- expires pending, waitlisted and invited requests when recruitment closes, a game is cancelled, or the game starts;
- processes only due records, so future games cannot starve overdue records behind the batch limit;
- uses game-first row locking for join, decision, withdrawal and expiry operations;
- remains idempotent, so repeated worker runs do not repeat expired-request transitions or notifications.

For a safe manual preview without database writes:

```powershell
python manage.py expire_matchmaking --dry-run --limit 100 --no-notify
```

The local `scripts/run_booking_worker.ps1` starts the unified maintenance worker with the project virtual environment when it exists. The worker checks every 10 seconds by default. For deployment, use one managed scheduler or worker; do not start multiple independent permanent workers.


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

Matchmaking: `/api/matchmaking/`

- `GET/POST games/`
- `GET games/eligible-bookings/`
- `GET games/my/`
- `GET games/{game_id}/`
- `GET games/{game_id}/manage/`
- `POST games/{game_id}/request/`
- `POST games/{game_id}/guests/`
- `GET games/{game_id}/players/lookup/`
- `POST games/{game_id}/invite/`
- `POST games/{game_id}/attach-booking/`
- `POST games/{game_id}/reconfirm/`
- `POST games/{game_id}/participants/{participant_id}/confirm-schedule/` (host acknowledgement for offline guests only)
- `POST games/{game_id}/leave/`
- `POST games/{game_id}/cancel/`
- `GET/PATCH games/{game_id}/room/`
- `POST requests/{request_id}/decide/`
- `POST requests/{request_id}/withdraw/`
- `POST requests/{request_id}/respond-invitation/`

Team Challenges: `/api/team-challenges/`

- `GET teams/` and `GET teams/{team_id}/` for challenge-eligible public team discovery.
- `GET/POST challenges/` for a player's relevant challenges and captain-authorized creation.
- `GET challenges/public/` for open challenges that can receive team responses.
- `GET challenges/{challenge_id}/` for challenge details, current proposal, responses, fixture, and permissions.
- `POST challenges/{challenge_id}/decision/` for captain accept/decline decisions.
- `POST challenges/{challenge_id}/counter/` for plan-first counter-proposals.
- `POST challenges/{challenge_id}/open-response/` to respond to an open challenge.
- `POST challenges/{challenge_id}/open-response/withdraw/` to withdraw an open-challenge response while it is still actionable.
- `POST challenges/{challenge_id}/select-opponent/` for the challenge creator to select one responding team.
- `POST challenges/{challenge_id}/withdraw/`, `attach-booking/`, `reschedule/`, `reconfirm/`, and `cancel/` for lifecycle actions.
- `GET challenges/{challenge_id}/room/` for protected confirmed-fixture coordination.
- `GET fixtures/{fixture_id}/eligible-players/`, `POST fixtures/{fixture_id}/participants/`, participant removal/attendance/dispute endpoints, and result submit/confirm endpoints for fixture management.

Attendance and reliability:

- `POST matchmaking/games/{game_id}/participants/{participant_id}/attendance/` lets the host mark a registered participant attended or absent after a completed Pickup/Fill My Squad game.
- `POST matchmaking/games/{game_id}/participants/{participant_id}/attendance/dispute/` lets only the affected player dispute a no-show report during the 24-hour review window.
- `POST team-challenges/fixtures/{fixture_id}/participants/{participant_id}/attendance/` and the matching `/attendance/dispute/` endpoint provide the same policy for confirmed team fixtures. Staff resolve a disputed commitment through `POST players/attendance/{commitment_id}/resolve/` with `outcome` set to `ATTENDED`, `NO_SHOW`, or `EXCUSED`.
- `ParticipationCommitment` is created only for confirmed registered players. Guests, pending requests, waitlisted players, provisional plan-first players, and cancelled/void commitments do not affect reliability.
- Late cancellation is measured against a four-hour pre-start cutoff. A reported no-show remains `NO_SHOW_REPORTED` for 24 hours; maintenance finalizes an undisputed report as `FINALIZED_NO_SHOW`. Reliability events are deduplicated per commitment outcome.

Team Challenge endpoints enforce active registered-captain permissions, immutable proposal versions, one selected opponent for open challenges, eligible booking ownership/status checks, booking reuse prevention, explicit schedule reconfirmation, protected fixture-room access, and active team-pair safeguards. State-changing matchmaking and challenge endpoints also use the shared mutation throttle configured by `SPORTSPOT_MUTATION_RATE`; safe read requests are not throttled by that mixin.

Venues/bookings: `/api/venues/`

- Owner venue/courts/slots/bookings/refunds/message endpoints under `owner/`, including `owner/bookings/verify/` for authenticated QR or booking-code verification.
- Owner location search and reverse lookup: `owner/location/search/`, `owner/location/reverse/`.
- Owner overview/calendar endpoints: `owner/overview/`, `owner/calendar/`, `owner/calendar/block/`.
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
- `backend/matchmaking/tests.py`
- `backend/team_challenges/tests.py`

The latest verified backend run on 2026-08-28 passed 151 tests across the explicit app suite, including matchmaking, Team Challenge fixture lifecycle, captain continuity, booking reuse, reconfirmation, venue location coverage, and authenticated WebSocket notification delivery. A focused notification real-time test and a focused `team_challenges` run passed. The suite uses the local PostgreSQL test configuration.

Run tests:

```powershell
cd backend
python manage.py test accounts teams venues notifications wishlists matchmaking team_challenges --keepdb
```

Run matchmaking lifecycle cleanup manually during local development or from a scheduler in staging/production:

```bash
python manage.py expire_matchmaking
python manage.py expire_matchmaking --dry-run
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

No frontend test runner is configured. The production Next.js build is the current frontend compile/type verification.

Recommended next tests: true concurrent reservations and challenge decisions, Khalti status mapping, cancellation tiers, refund transitions, notification seen/read security, Redis-backed multi-worker WebSocket delivery, discovery zero-result filters, staff dispute resolution, and browser-level lifecycle tests.

## 20. Known Issues and Limitations

- Pickup Game and Fill My Squad matchmaking are implemented for booking-first and plan-first journeys, including controlled area data, role-based requests, backend-validated discovery filters, host decisions, waitlist recovery, guest participants, registered-player invitations by SportSpot ID, invitation expiry, immutable request history, duplicate-request protection, guided court-booking handoff after a plan reaches its threshold, idempotent payment initiation, automatic booking attachment after verified Khalti payment, payment reconciliation recovery, participant-specific schedule reconfirmation, explicit host acknowledgement for offline guests, safe public and planning-room roster payloads, quiet detail-page refreshes, automatic maintenance, structured room access, shared participation commitments, post-game host attendance recording, player dispute protection, and authenticated notification push delivery with REST fallback. Remaining gaps include pagination, Redis-backed multi-worker push deployment, deeper high-concurrency/end-to-end coverage, richer room activity, and staff dispute tooling. After a completed Fill My Squad game, the captain can send a separate permanent-team invitation through the existing team invitation workflow. Team Challenges now include proposal rescheduling/reconfirmation, active-captain continuity, protected fixture-room access, lineup attendance review with player dispute protection, result confirmation, and verified rating eligibility; remaining gaps include staff dispute tooling, richer room activity, deeper concurrency coverage, and production scheduling/push infrastructure.
- The current workspace has valid PostgreSQL test credentials and the full `matchmaking`, `venues`, `teams`, and `team_challenges` regression suite passes. A clean-machine setup still requires matching local database credentials in the ignored `backend/.env` (and `TEST_DB_PASSWORD` when using separate test credentials).
- Several placeholder pages still exist for future modules.
- Future-compatible Futsal fields remain in `PlayerProfile`, but current UI must stay Cricksal-only.
- No production deployment files, Docker config, CI/CD, or monitoring.
- No frontend tests.
- Khalti requires environment credentials and manual end-to-end verification.
- The default map tiles and geocoder use public OpenStreetMap services for local development; they must be replaced or formally approved for production-scale traffic.
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
- Owner location search and reverse lookup are authenticated owner-only endpoints; public coordinates are released only after owner confirmation and are restricted to Nepal bounds.
- Khalti secret is environment-based.
- `.env` and `.env.local` are gitignored.

Remaining risks:

- Tokens are stored client-side for development convenience.
- Authenticated state-changing matchmaking and Team Challenge endpoints use a configurable shared mutation throttle (`SPORTSPOT_MUTATION_RATE`); broader abuse prevention and moderation are not implemented.
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
- Configure a production map tile provider and backend geocoder, including attribution, request identification, rate limits, monitoring, and provider terms.
- Move media/static handling to production-ready storage.
- Protect verification documents.
- Run booking maintenance as a managed background process in deployment.
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

- Player Dashboard UI pages and shared shell refinement.
- Shared SportSpot UI language, global feedback, compact controls, responsive states, and route-aware back navigation across the primary user flows.
- Player Settings edit/cancel behavior and safe email-change flow.
- Redesigned Player Create Team page.
- Venue Manager top bar, sidebar, mobile drawer, Overview, Calendar, venue/court pages, bookings, refunds, slot management, and scoped destination-page design polish for owner workspace routes.
- Court discovery filters and venue card UX.
- Wishlist integration in Player top navigation.
- Booking lifecycle, cancellation, refunds, Khalti idempotency, and paid-after-expiry safety.
- Notifications and toast feedback.
- Email verification and password recovery.
- Team Challenge lifecycle hardening: direct/open challenges, multiple open responses with one opponent selection, immutable proposals, booking-first/plan-first handoff, retry-safe decisions, booking reuse prevention, proposal-version rescheduling, explicit reconfirmation, linked-booking synchronisation, active-captain continuity, notifications, expiry maintenance, and protected fixture-room coordination with lineup, shared attendance commitments, bounded player disputes, and result confirmation.

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
- `backend/team_challenges/models.py`
- `backend/team_challenges/services.py`
- `backend/team_challenges/views.py`
- `backend/team_challenges/tests.py`
- `frontend/components/Navbar.tsx`
- `frontend/components/AppChrome.tsx`
- `frontend/components/owner/VenueOwnerTopBar.tsx`
- `frontend/components/owner/VenueOwnerDashboardLayout.tsx`
- `frontend/components/owner/VenueOwnerSidebar.tsx`
- `frontend/app/dashboard/owner/page.tsx`
- `frontend/app/dashboard/owner/calendar/page.tsx`
- `frontend/components/NotificationCenter.tsx`
- `frontend/components/ToastProvider.tsx`
- `frontend/app/courts/page.tsx`
- `frontend/app/courts/[id]/page.tsx`
- `frontend/app/dashboard/owner/venue-setup/page.tsx`
- `frontend/app/dashboard/player/bookings/payment/[bookingId]/page.tsx`

Current blockers:

- SMTP and Khalti secrets must be configured locally.
- Production deployment is not designed; Redis and an ASGI-capable service still need to be provisioned for shared push delivery.
- Future modules need new models/APIs.
- Dual-role account switching requires backend support before it can be shown in the owner profile menu.

Before implementing a feature, verify its current frontend, backend, database and permission status. Do not assume that a visible page means the feature is complete.

Recommended next task: run browser-level QA for the completed Venue Owner destination pages and for booking, matchmaking, challenge reconfirmation, fixture attendance/result confirmation, rating eligibility, and Notification Centre push/reconnect behavior. Then add report CSV export/comparison periods, true concurrent transaction tests, dispute/moderation controls, and production-managed scheduling, Redis, and ASGI deployment.

Commands before new work:

```powershell
git status --short
cd backend
python manage.py check
python manage.py test accounts players teams matchmaking team_challenges notifications venues wishlists --keepdb
cd ..\frontend
npm run build
```

README maintenance rule: update this README in the same change as every feature, bug fix, migration, API, workflow, environment, test, or deployment update. Keep implementation status, known limitations, workflows, and handover notes aligned with verified repository evidence. Never mark a feature Completed solely because a page or endpoint exists.

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
