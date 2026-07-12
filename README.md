# SportSpot

SportSpot is a Nepal-focused sports coordination platform for cricksal and futsal players, teams, and court owners. It helps users discover courts, join games, find missing players, challenge opponent teams, manage bookings, and coordinate confirmed matches through a shared Game Room.

# SportSpot

SportSpot is a Nepal-focused sports coordination platform for cricksal and futsal players, teams, and court owners. It helps users discover courts, join games, find missing players, challenge opponent teams, manage bookings, and coordinate confirmed matches through a shared Game Room.

Tagline:

> Find Courts. Join Games. Challenge Teams. Play with Trust.

## Project Overview

In Nepal, many cricksal and futsal activities are still coordinated manually through phone calls, Messenger, WhatsApp, and direct contact. This often creates unclear court availability, double bookings, difficulty finding players, difficulty finding opponents, and weak coordination after a match is scheduled.

SportSpot is designed as more than a court booking website. Its main purpose is sports coordination. Court booking is one important part of the system, but the core value is helping players and teams organize real matches with better trust, visibility, and follow-up.

The platform focuses on:

- Court discovery and transparent slot availability
- Open player slots for teams that need missing players
- Team challenge and counter-proposal workflows
- Confirmed match coordination through a Game Room
- Player, team, and venue reliability tracking
- Manual/offline booking support for court owners
- Rule-based recommendations with clear explanations

The system is designed for realistic use in Kathmandu Valley, Pokhara, and similar urban sports communities in Nepal.

## Problem Statement

Local cricksal and futsal players often face practical coordination problems:

- Courts are booked manually, so availability is not always clear.
- Court owners may accidentally double-book slots.
- Captains struggle to find reliable missing players.
- Teams struggle to find opponent teams with similar skill levels.
- Unknown players and teams have limited trust signals.
- Match information is scattered across chats and calls.
- Players have no proper match history, rating, or reliability record.
- Court owners need a way to manage both online and offline bookings.

SportSpot solves these problems by combining court booking, player matchmaking, team challenge management, and match coordination into one platform.

## Core Objectives

- Build a professional sports coordination platform for cricksal and futsal.
- Allow players to find courts, join games, create teams, and challenge other teams.
- Allow captains to manage teams, invite players, add guest players, and post missing-player needs.
- Allow court owners to manage venues, courts, slots, bookings, offline bookings, and reviews.
- Allow admins to verify venues, oversee bookings, manage users, and handle disputes.
- Improve trust through ratings, reliability scores, match history, attendance, and feedback tags.
- Keep the MVP practical by using mock payment, simple results, and rule-based recommendations.

## Tech Stack

### Frontend

- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui

### Backend

- Django
- Django REST Framework
- PostgreSQL
- SimpleJWT authentication

### Architecture

SportSpot uses a separated frontend and backend architecture.

- Next.js handles the user interface and frontend routing.
- Django REST Framework provides the backend API.
- PostgreSQL stores users, venues, bookings, teams, matches, ratings, and platform data.
- The frontend communicates with the backend through REST APIs.
- Main backend business logic should remain in Django, not inside Next.js.

## User Roles

SportSpot has three global account roles:

- `PLAYER`
- `COURT_OWNER`
- `ADMIN`

Captain is not a global role. A captain is a team-level role. A user can be a normal player globally, captain of one team, and a normal member of another team.

## Key Concepts

### Registered Players

Registered players have login access, profiles, sports identity, match history, ratings, reliability scores, and notifications.

### Guest Players

Guest players are manually added by captains for real-world flexibility. They do not have login access, notifications, ratings, reliability scores, or match history.

### Game Room

A Game Room is a shared match workspace created only after a match is officially scheduled. It is not a general team chat or team room. It is connected to one confirmed match and contains match overview, lineups, booking pass, availability, announcements, attendance, results, ratings, and dispute/report options.

### Reliability Score

Reliability is a simple, transparent score based on attendance, completed matches, ratings, no-shows, and late cancellations. It should be easy for users and evaluators to understand.

### Rule-Based Recommendation

SportSpot does not use fake AI in the MVP. Recommendations are based on clear rules such as sport, role, skill level, location, availability, ratings, and reliability. Every recommendation should explain why it was shown.

## Main Modules

1. Authentication and role-based access
2. Player profile and sports identity
3. Team management
4. Venue and court management
5. Slot availability and court booking
6. Mock payment and booking pass
7. Matchmaking and open player slots
8. Team challenge and counter proposal
9. Game Room
10. Rating and reliability system
11. Rule-based recommendation system
12. Notification system
13. Court owner dashboard
14. Admin dashboard
15. Dispute and report system

## Core Features

### Authentication

- Public registration for players and court owners
- Admin accounts managed internally
- Email-based login
- JWT authentication using SimpleJWT
- Role-based dashboard redirection

After login:

- Players go to `/dashboard/player`
- Court owners go to `/dashboard/owner`
- Admins go to `/dashboard/admin`

### Player Profile

Each registered player has a sports identity profile containing:

- SportSpot Player ID
- Profile photo
- Preferred sport: cricksal or futsal
- Skill level
- Location
- Weekly availability
- Preferred playing role
- Reliability score
- Average rating
- Match history summary
- Feedback tags

The MVP should focus on participation, trust, and reliability. It should not include full cricket scoring, ball-by-ball tracking, detailed futsal statistics, or advanced performance analytics.

### Team Management

Players can create teams. The creator automatically becomes the team captain.

Team management includes:

- Team profile
- Team members
- Guest players
- Captain role
- Registered player invitations
- Guest player management
- Team reliability
- Team rating
- Challenge history
- Match history
- Open player needs

Captains can:

- Edit team details
- Invite registered players
- Add guest players
- Remove members
- Transfer captaincy
- Post open player slots
- Challenge other teams
- Accept or reject challenges
- Manage match lineups in the Game Room

### Venue and Court Management

Court owners can register venues and manage courts.

Venue details include:

- Venue name
- Address and location
- Supported sports
- Facilities
- Rules
- Cancellation policy
- Refund policy
- Opening and closing time
- Verification status

Court details include:

- Court name
- Sport type
- Price per slot
- Off-peak price
- Slot duration
- Active/inactive status
- Photos

Because many Nepal-based bookings still happen offline, court owners must be able to add manual bookings or block slots from the calendar.

### Court Discovery and Booking

Users can discover courts from the main public website, not only from dashboards.

Court discovery filters:

- Sport
- Location
- Date
- Time
- Price range
- Rating
- Facilities
- Available now
- Off-peak discount

Booking flow:

1. User selects a court.
2. User selects date and time slot.
3. System reserves the slot temporarily.
4. User completes mock payment.
5. Booking is confirmed.
6. Booking pass is generated.
7. Slot becomes locked for other users.

The backend must prevent double booking through proper database transaction handling.

### Mock Payment

The MVP uses mock payment only.

Payment flow:

1. Booking is reserved.
2. User opens mock payment page.
3. User chooses simulate success or simulate failure.
4. Success confirms the booking.
5. Failure cancels or expires the reservation.

Real eSewa or Khalti integration can be treated as future scope.

### Booking Pass

After successful payment, SportSpot generates a digital booking pass showing:

- Booking ID
- Venue
- Court
- Sport
- Date and time
- Booked by
- Payment status
- Booking status
- Venue rules reminder

QR code support can be added later.

### Matchmaking and Open Player Slots

Captains can post open player slots when they need missing players for a match.

Solo player flow:

1. Player opens the Find Game page.
2. Player filters open slots by sport, location, role, skill, and time.
3. Player sends a join request.
4. Captain receives a notification.
5. Captain reviews the player card.
6. Captain accepts or rejects the request.
7. Accepted player joins that match lineup only.

Accepted open-slot players do not automatically become permanent team members.

### Team Challenge System

SportSpot supports two challenge modes.

#### Mode A: Proposed Challenge

A team wants to challenge another team but has not booked a court yet.

Flow:

1. Team A sends a challenge proposal.
2. Team B accepts, rejects, or sends a counter proposal.
3. Both teams agree on date, time, location, and team size.
4. System checks court availability.
5. Slot is reserved temporarily.
6. Captain completes mock payment.
7. Booking is confirmed.
8. Match is scheduled.
9. Game Room is created.

Important rule: Challenge accepted does not mean match scheduled. A match is scheduled only after booking is confirmed.

#### Mode B: Booked Court Challenge

A team already has a confirmed booking and needs an opponent.

Flow:

1. Team A books a court.
2. Team A posts an opponent-needed request.
3. Team B accepts.
4. Match is scheduled.
5. Game Room is created.

The system should not automatically cancel a booking if no opponent accepts. The captain decides whether to cancel, keep, or play internally.

### Game Room

The Game Room is the match control center.

Game Room sections:

- Match overview
- Lineups
- Booking pass
- Player availability
- Announcements
- Attendance/check-in
- Simple result
- Ratings
- Dispute/report

Locked information:

- Venue
- Court
- Date
- Time
- Booking ID
- Payment status
- Booking status
- Cancellation policy

Captains can manage lineups, announcements, attendance, missing-player slots, simple results, and reschedule/cancel requests.

Players can view match details, mark availability, view the booking pass, read announcements, rate after the match, and report issues.

### Ratings and Reliability

Ratings unlock only after a match is completed.

Rating types:

- Player rating
- Team rating
- Court review

Player rating dimensions:

- Punctuality
- Sportsmanship
- Teamwork
- Skill impression
- Communication/reliability

Team rating dimensions:

- Arrival timing
- Fair play
- Coordination
- Behavior
- Match confirmation reliability

Court review dimensions:

- Court quality
- Facility quality
- Staff behavior
- Location accuracy
- Value for money

Guest players cannot give or receive ratings.

### Notifications

The MVP should use database notifications. Real-time WebSocket notifications can be future scope.

Notification examples:

- Team invitation received
- Join request received
- Challenge received
- Counter proposal received
- Booking confirmed
- Match scheduled
- Player marked unavailable
- Result submitted
- Rating pending
- Venue approval status
- Dispute update

### Court Owner Dashboard

Court owners can manage:

- Venue registration
- Court setup
- Slot calendar
- Offline bookings
- Online bookings
- Payment status
- Reviews
- Revenue summary
- Occupancy rate
- Analytics

Slot calendar statuses:

- Available
- Reserved
- Confirmed
- Offline booking
- Blocked
- Cancelled

### Admin Dashboard

Admins can manage and monitor:

- Users
- Court owners
- Venue approvals
- Teams
- Bookings
- Payments
- Matches
- Game Rooms
- Reviews
- Disputes
- Platform analytics

Admin features include venue verification, user suspension/reactivation, fake team moderation, review moderation, and dispute resolution.

### Dispute and Report System

Users can report:

- Opponent no-show
- Player no-show
- Court unavailable despite booking
- Wrong result
- Payment issue
- Fake review
- Bad behavior

Admins can review reports, inspect related booking/match details, update status, and add admin notes.

## Public Pages

- Landing page
- Login
- Register
- Court discovery
- Venue detail
- Find Game
- Challenge Teams
- Team public preview

## Player Pages

- Player dashboard
- Player profile
- My teams
- Create team
- Team detail
- Invite registered player
- Add guest player
- Find Game
- Player card preview
- Challenge proposal form
- Counter proposal form
- My bookings
- Booking pass
- Game Room
- Rating screen
- Notifications

## Court Owner Pages

- Owner dashboard
- Venue registration
- Venue management
- Court management
- Slot calendar
- Add offline booking
- Booking management
- Payment status
- Owner analytics
- Reviews

## Admin Pages

- Admin dashboard
- Court owner approval
- Venue verification
- User management
- Team management
- Booking oversight
- Match/Game Room oversight
- Review moderation
- Dispute center
- Platform analytics

## Landing Page Direction

Hero title:

> Find Courts. Join Games. Challenge Teams.

Subtitle:

> SportSpot helps players and teams in Nepal discover courts, find missing players, challenge opponents, and manage confirmed matches through one smart sports platform.

Primary actions:

- Book a Court
- Find a Game
- Challenge a Team

Suggested sections:

- Popular Courts Near You
- Open Cricksal Games
- Teams Looking for Opponents
- How SportSpot Works
- Why Trust SportSpot?
- For Court Owners

Suggested visual style:

- Modern
- Sporty
- Mobile-first
- Clean dashboard-style cards
- Strong status badges
- Clear call-to-action buttons
- Dark navy, sports green, white, and orange/yellow accents

## Mobile-First Requirement

Most target users are expected to use mobile phones, so the UI should be mobile-first.

Suggested mobile player bottom navigation:

- Home
- Find Game
- Book
- Teams
- Profile

Suggested mobile owner bottom navigation:

- Dashboard
- Calendar
- Bookings
- Venue
- Profile

Desktop dashboards should use sidebar navigation where appropriate.

## MVP Scope

The MVP should include:

- Authentication
- Player profiles
- Team creation and member management
- Guest player support
- Venue and court management
- Slot availability
- Court booking
- Mock payment
- Booking pass
- Open player slots
- Join requests
- Team challenge proposal
- Counter proposal
- Game Room
- Simple result submission
- Rating and reliability
- Rule-based recommendations
- Notifications
- Owner dashboard
- Admin dashboard
- Basic dispute handling

## Out of Scope for MVP

The following features should be treated as future enhancements:

- Real production payment
- eSewa/Khalti live integration
- QR check-in
- Full chat system
- Tournament system
- Full cricket scoring
- Ball-by-ball tracking
- Detailed futsal statistics
- Split payment
- Machine learning recommendations
- Native mobile app

## Development Roadmap

### Phase 1: Project Setup and Authentication

- Create Django backend project
- Create Next.js frontend project
- Configure PostgreSQL
- Create custom user model
- Implement register/login APIs
- Add JWT authentication
- Add current user API
- Build login/register UI
- Add role-based dashboard placeholders

### Phase 2: Player Profile

- Create player profile model
- Add sports identity fields
- Add profile create/edit APIs
- Build profile frontend
- Initialize rating and reliability fields

### Phase 3: Team Management

- Create team model
- Create team member model
- Add captain role logic
- Add registered player invitation
- Add guest player support
- Build team detail page

### Phase 4: Venue and Court Management

- Create venue model
- Create court model
- Add owner venue registration
- Add admin approval flow
- Build court management UI

### Phase 5: Slot and Booking System

- Create court slot model
- Create booking model
- Add slot availability
- Add temporary reservation
- Prevent double booking
- Implement booking status flow

### Phase 6: Mock Payment and Booking Pass

- Create payment model
- Add mock payment success/failure
- Confirm booking after successful payment
- Generate booking pass

### Phase 7: Matchmaking and Open Player Slots

- Create open player slot model
- Create join request model
- Build Find Game page
- Add captain accept/reject flow
- Build player card preview

### Phase 8: Team Challenge and Counter Proposal

- Create challenge model
- Add proposed challenge flow
- Add booked-court opponent-needed mode
- Add counter proposal
- Implement challenge status flow

### Phase 9: Game Room

- Create match model
- Create Game Room model
- Add lineups
- Add announcements
- Add player availability
- Add attendance
- Add simple result submission

### Phase 10: Ratings and Reliability

- Create rating model
- Add player/team/court ratings
- Unlock ratings after completed match
- Update reliability score

### Phase 11: Rule-Based Recommendations

- Add court recommendations
- Add player recommendations
- Add opponent/team recommendations
- Add match score explanation
- Show "Why recommended?"

### Phase 12: Court Owner Dashboard

- Add owner analytics
- Add today/upcoming bookings
- Add offline booking
- Add slot calendar
- Add reviews summary

### Phase 13: Admin Dashboard

- Add venue approvals
- Add user management
- Add booking oversight
- Add match/Game Room oversight
- Add review moderation
- Add dispute center
- Add platform analytics

### Phase 14: Testing and Polish

- Test APIs
- Test frontend workflows
- Add seed demo data
- Fix bugs
- Polish UI
- Prepare final documentation

## Sample Data

Sample locations:

- Baneshwor
- Maitidevi
- Lalitpur
- Bhaktapur
- Pokhara
- Chabahil
- Koteshwor
- Boudha

Sample venues:

- ABC Cricksal Arena
- Baneshwor Futsal Hub
- Pokhara Sports Court
- Lalitpur Turf Zone
- Maitidevi Indoor Cricket

Sample teams:

- ABC Strikers
- Kathmandu Warriors
- Baneshwor Blazers
- Lalitpur Legends
- Pokhara Panthers

## Development Guidelines

- Build the system incrementally, phase by phase.
- Implement only the requested phase.
- Keep backend business logic inside Django.
- Keep frontend and backend cleanly separated.
- Use RESTful API design.
- Avoid unnecessary complexity.
- Use realistic demo data.
- Keep recommendations explainable.
- Test each phase before moving forward.
- Do not add future modules before they are needed.

## Final Project Identity

SportSpot is not just a booking system. It is a sports coordination platform built around real local problems: finding courts, finding players, finding opponents, confirming matches, coordinating teams, and building trust through reliability.

Its professional identity is:

> A smart sports coordination platform for Nepal that connects players, teams, and venues through court booking, matchmaking, team challenges, and trusted match management.


Tagline:

> Find Courts. Join Games. Challenge Teams. Play with Trust.

## Phase 1 Status

This repository currently implements Phase 1 only:

- Django REST Framework backend project setup
- Custom email-based user model
- JWT authentication with SimpleJWT
- Public registration for players and court owners
- Login API returning access/refresh tokens
- Current user API
- Empty `players` and `venues` apps for future phases
- Next.js frontend with landing, login, register, and dashboard placeholder pages
- Frontend auth and API helpers

Future modules such as player profiles, teams, venues, booking, payment, matchmaking, challenges, Game Room, ratings, recommendations, analytics, and disputes are intentionally not implemented yet.

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
  "password": "strong-password",
  "role": "PLAYER"
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
- Login page receives JWT tokens.
- Login redirects users based on role:
  - `PLAYER` -> `/dashboard/player`
  - `COURT_OWNER` -> `/dashboard/owner`
  - `ADMIN` -> `/dashboard/admin`
- Navbar changes after login and logout.

## Product Identity

SportSpot is not only a booking system. It is a sports coordination platform built around real local problems: finding courts, finding players, finding opponents, confirming matches, coordinating teams, and building trust through reliability.
