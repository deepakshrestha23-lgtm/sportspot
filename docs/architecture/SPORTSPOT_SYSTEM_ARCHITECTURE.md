# SportSpot System Architecture

This is the current production architecture of SportSpot, based on the deployed Elastic Beanstalk environments and repository configuration verified during this work. The presentation diagram is [SPORTSPOT_SYSTEM_ARCHITECTURE.svg](SPORTSPOT_SYSTEM_ARCHITECTURE.svg), with a report-ready [PNG export](SPORTSPOT_SYSTEM_ARCHITECTURE.png). The companion [Mermaid file](SPORTSPOT_SYSTEM_ARCHITECTURE.mmd) provides a text-editable structural version of the same current-state topology.

## Scope

The diagram describes the web application, API boundary, real-time transport, persistent storage, third-party integrations, and release path. It is a deployment-oriented C4 container diagram: it deliberately avoids presenting individual Django models or every UI page as separate services.

## Runtime components

| Boundary | Current implementation | Responsibility |
| --- | --- | --- |
| Web client | Browser running the Next.js application | Screens, local session state, REST and WebSocket clients, hosted-payment redirect. |
| Web environment | `sportspot-web-https` on Elastic Beanstalk | Next.js 15 / React 19 standalone Node.js runtime and static application assets. |
| API environment | `sportspot-api-https` on Elastic Beanstalk | Django 5, DRF, Daphne, ASGI, domain services, validation, authorization, and transactional workflows. |
| Identity | Custom Django email user plus Simple JWT | Verified email accounts, role-based access, access-token renewal, and protected API/WebSocket access. |
| Real-time | Django Channels | Notification, game-room, and team-fixture chat WebSockets. The current single API instance uses Channels' in-memory layer. |
| Database | Amazon RDS PostgreSQL | The authoritative store for accounts, venue inventory, bookings, payments, games, challenges, scorecards, notifications, and audit records. |
| Media | Amazon S3 `sportspot-media-982190581643` | Venue, court, player, and team media; private verification documents are accessed through signed URLs. |
| Payments | Khalti | Payment initiation, hosted payment handoff, and server-side verification. |
| Email | Configured SMTP provider | Verification OTP, password, booking, venue, team, and refund emails; delivery outcomes are recorded. |
| Maps | OpenStreetMap / Nominatim | Place search and reverse geocoding for venue and planning locations. |

## Important implementation notes

- The API is the only authority for business state. The frontend never writes directly to PostgreSQL, S3, Khalti, or SMTP.
- Browser REST requests use bearer JWTs. WebSocket clients connect with WSS and authenticate immediately after connection; tokens are not placed in the URL.
- Venue and booking changes are handled by Django domain services and PostgreSQL transactions. Cricket scoring persists each submitted action as an auditable database event.
- Media storage is durable across Elastic Beanstalk instance replacement because production enables S3-backed Django storage.
- A Redis channel layer is not currently configured. This is correct for the present single API instance, but Redis should be introduced before horizontal API scaling so WebSocket broadcasts work across instances.
- Deployments are currently release-driven: a validated build is packaged as an Elastic Beanstalk application version, then deployed to the web or API environment. This diagram does not claim a CI/CD service that is not configured.

## Interfaces

| From | To | Protocol / control |
| --- | --- | --- |
| Browser | Web environment | HTTPS through the web Elastic Beanstalk load balancer. |
| Browser and Next.js client | API environment | HTTPS REST with bearer JWT authentication. |
| Browser | API environment | WSS for notifications and protected chat, authenticated immediately after connection. |
| API | PostgreSQL | Django ORM and database transactions. |
| API | S3 | Django S3 storage; signed URLs for private media access. |
| API | Khalti | Server-side payment initiation and verification. |
| API | SMTP provider | Authenticated outbound email. |
| API | Nominatim | HTTPS geocoding requests. |

## Presentation guidance

Use the SVG for reports and presentation slides; it is editable in standard vector design tools. Use the Mermaid file when a text-based architecture diagram is more convenient to maintain. Do not add unavailable infrastructure such as Redis, CloudFront, a message broker, containers, or CI/CD pipelines to the current-state diagram; they are future options, not deployed SportSpot components.
