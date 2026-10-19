> Target architecture, not current runtime functionality. Phase 01B uses a sanitized published-bulletin table instead of the original view. Authentication, server mutations and Realtime remain Phase 02 work. See [current security model](SECURITY_MODEL.md).

# PPR NADI — Architecture Specification

## 1. System Overview
**PPR NADI** is a real-time, resident-centred community infrastructure intelligence platform designed for Malaysian *Program Perumahan Rakyat* (PPR) high-density public housing.

It provides a transparent, dual-portal architecture:
- **Resident Portal (`/resident`):** Mobile-first, simple Bahasa Melayu interface for residents to view live building status, submit private reports with photos, track progress, and receive official broadcast updates without manual page refreshes.
- **Management Operations Portal (`/management`):** Desktop-first operations map for triage, evidence inspection, multi-report linking, human verification, contractor task dispatch, and verified dual-check service restoration.

```
                      +---------------------------------------+
                      |         PPR NADI Application          |
                      |          (Next.js App Router)         |
                      +-------------------+-------------------+
                                          |
                        +-----------------+-----------------+
                        |                                   |
              [ Resident Portal ]                [ Management Portal ]
                   /resident                          /management
                        |                                   |
                        +-----------------+-----------------+
                                          |
                         Next.js Server Actions / API Routes
                               (Zod Validation Layer)
                                          |
                               Supabase Client (SSR)
                                          |
+-----------------------------------------------------------------------------------+
|                               Supabase PostgreSQL                                 |
|                                                                                   |
|  - 13 Relational Domain Tables                                                     |
|  - Row Level Security (Default DENY)                                              |
|  - Safe Public Projection View (`published_incident_bulletins`)                   |
|  - Trigger-enforced role protection (cannot self-assign management)               |
|  - Private Evidence Storage Bucket (`incident-evidence`)                          |
|  - Realtime Replication for instant push to resident screens                      |
+-----------------------------------------------------------------------------------+
```

## 2. Technology Stack
- **Framework:** Next.js 16.4+ (App Router, Turbopack, React 19)
- **Language:** TypeScript (Strict mode enabled)
- **Styling:** Tailwind CSS (v4) with NADI Civic Atlas design tokens
- **Icons:** Lucide React
- **Validation:** Zod
- **Backend & Auth:** Supabase PostgreSQL, Supabase Auth, Supabase Storage, Supabase Realtime
- **Testing:** Vitest for domain logic and data contract assertions

## 3. Core Database Tables (13 Domains)
1. `profiles`: User identity linked to `auth.users`. Role is strictly `resident` or `management`.
2. `buildings`: Residential blocks (e.g. Blok A, Blok B, Blok C).
3. `service_zones`: Infrastructure distribution areas (e.g., floors 1–7 vs 8–15).
4. `facilities`: Physical assets (pumps, lifts, corridor lighting circuits).
5. `facility_dependencies`: Directed graph mapping assets to dependent service zones.
6. `incident_reports`: Private reports submitted by individual residents.
7. `report_attachments`: Metadata for private evidence files stored in Supabase Storage.
8. `incidents`: Management-recognised, verified infrastructure incidents.
9. `incident_report_links`: Aggregation entity linking multiple resident reports to one root incident.
10. `incident_updates`: Official verified bulletins with publication state (`is_published`).
11. `maintenance_tasks`: Contractor actions, parts, and dispatch status.
12. `temporary_support_notices`: Relief arrangements (e.g. mobile water tankers, shuttle lifts).
13. `audit_events`: Immutable security and operational audit trail.

## 4. Architectural Boundaries
- **Zero Public Access to Unverified Reports:** Resident reports are strictly private to the reporter and authorized management.
- **Human Verification Required:** A resident report never automatically becomes a public incident.
- **Safe Public Projection:** Residents access verified incident updates via `published_incident_bulletins`, preventing exposure of internal technician notes, contractor costs, or private reporter details.
