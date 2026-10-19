# PPR NADI — Phase 02A Database Validation and Security Testing Report

## Executive Summary

Phase 02A successfully established, validated, and security-tested the database layer of **PPR NADI** within an isolated, disposable local Supabase/PostgreSQL instance.

All four database migrations executed without errors. Comprehensive testing across raw PostgreSQL sessions, PostgREST HTTP endpoints, Supabase Storage APIs, and concurrent race-condition scenarios confirmed that all RLS policies, trigger guards, physical projection synchronizations, and audit immutability mechanisms behave strictly according to the approved security architecture.

---

## 1. Environment & Database Identity (Non-Secret)

| Component | Version / Specification | Notes |
| :--- | :--- | :--- |
| **Operating System** | Windows 11 Pro (win32 x64) | Shell: PowerShell (`pwsh`) |
| **Supabase CLI** | `v2.116.0` | Scoop shim at `~/.scoop/shims/supabase.exe` |
| **Docker Engine** | `v29.8.1` (`desktop-linux`) | Docker Desktop Engine running |
| **PostgreSQL Engine** | `15.8.1.085` (`public.ecr.aws/supabase/postgres`) | Isolated container: `supabase_db_ppr-nadi` |
| **PostgreSQL Client** | `psql (PostgreSQL) 18.6` | `C:\Program Files\PostgreSQL\18\bin\psql.exe` |
| **Node.js** | `v24.18.1` | Native fetch, crypto, and child_process |
| **Project ID** | `ppr-nadi` | Isolated from other local projects |
| **Kong API URL** | `http://127.0.0.1:64321` | Offset port (`64321`) |
| **REST (PostgREST)**| `http://127.0.0.1:64321/rest/v1` | PostgREST `v16.1` |
| **Studio URL** | `http://127.0.0.1:64323` | Offset port (`64323`) |
| **InBucket / SMTP** | `http://127.0.0.1:64324` | Mailpit `v1.30.2` |
| **Database Port** | `127.0.0.1:64322` | Offset DB port (`64322`) |

> [!NOTE]
> **Coexistence Verification**: The unrelated local container stack (`harmony-health-management`) running on standard ports `54321`–`54327` remained online and completely undisturbed throughout this task. Zero host port collisions occurred.

---

## 2. Migration Execution Results

Migrations were applied in timestamp order against the fresh database instance during startup:

| Migration File | Timestamp Order | Status | Execution Details |
| :--- | :---: | :---: | :--- |
| `20261016160000_core_schema.sql` | 1 | **PASSED** | Core domain schema, tables, constraints, foreign keys, indexes created. |
| `20261016160100_synthetic_demo_seed.sql` | 2 | **PASSED** | Seeded Blocks A, B, C; bounded service zones; Blok B core facilities. |
| `20261016160200_rls_and_security_closure.sql` | 3 | **PASSED** | Security definer helpers, trigger guards, physical bulletin table, sync triggers, audit log trigger, and explicit table RLS policies applied. |
| `20261016160300_storage_evidence_bucket.sql` | 4 | **PASSED** | Private `incident-evidence` storage bucket provisioned, evidence ownership helpers, RLS policies, and 3-attachment serializing trigger applied. |

- **Exit Code**: `0`
- **Errors**: `None`
- **Re-runs Required**: None; all 4 migrations succeeded on first execution.

---

## 3. Confirmed Defects and Exact Fixes

| # | Discovered Issue | Root Cause | Exact Resolution |
| :--- | :--- | :--- | :--- |
| **1** | Default port collision with existing container stack | Default ports (`54321`–`54327`) were already bound by `harmony-health-management`. | Configured `supabase/config.toml` with `6432x` series offset ports and pinned `major_version = 15`. |
| **2** | Missing seed file warning | `config.toml` pointed to `./seed.sql` which did not exist. | Created clean `supabase/seed.sql` file. |
| **3** | Unassigned user test coverage gap | Phase 01B SQL harness tested Resident A/B and Manager A/B but omitted unassigned authenticated users (`assigned_estate_id IS NULL`). | Added Test Suite 2 in `tests/sql/phase02a-security-suite.sql` confirming unassigned users see 0 estate rows and cannot submit reports. |
| **4** | Facility category mismatch coverage gap | Phase 01B test covered building mismatches but did not assert category mismatches (e.g. lift facility on water incident). | Added Test 4.4 in `tests/sql/phase02a-security-suite.sql` verifying `Incident facility must match building and category` trigger enforcement. |
| **5** | Vitest glob capturing standalone scripts | Standalone runtime scripts (`api-and-storage.test.mjs`, `concurrency.test.mjs`) were matched by vitest's default file pattern, failing with "No test suite found". | Updated [vitest.config.ts](file:///c:/Dev/ppr-nadi/vitest.config.ts) to explicitly scope tests to `tests/**/*.test.ts`, keeping Vitest unit tests separate from runtime integration tests. |

---

## 4. Exact Files Changed

```
supabase/
├── config.toml                     (Modified: Custom ports 64321-64329, postgres 15)
└── seed.sql                        (Created: Clean seed placeholder)

tests/
├── sql/
│   ├── phase01b-security.sql       (Unmodified baseline test harness)
│   ├── phase02a-security-suite.sql (Created: Comprehensive 8-suite SQL security test)
│   └── seed-test-identities.sql    (Created: Synthetic test identities for HTTP/API tests)
├── api-and-storage.test.mjs        (Created: PostgREST & Storage API verification)
└── concurrency.test.mjs            (Created: Multi-session PostgreSQL concurrency test)

vitest.config.ts                    (Modified: Scoped test files to tests/**/*.test.ts)
docs/
└── PHASE_02A_DATABASE_VALIDATION_REPORT.md (Created: This report)
```

---

## 5. SQL Security Test Results

### Suite A: Phase 01B Baseline Test Harness (`tests/sql/phase01b-security.sql`)
- **Execution Command**:
  ```powershell
  & "C:\Program Files\PostgreSQL\18\bin\psql.exe" "postgresql://postgres:postgres@127.0.0.1:64322/postgres" -v ON_ERROR_STOP=1 -f tests/sql/phase01b-security.sql
  ```
- **Exit Code**: `0`
- **Result**: All 38 assertions and error expectations passed cleanly and rolled back.

### Suite B: Phase 02A Expanded Security Suite (`tests/sql/phase02a-security-suite.sql`)
- **Execution Command**:
  ```powershell
  & "C:\Program Files\PostgreSQL\18\bin\psql.exe" "postgresql://postgres:postgres@127.0.0.1:64322/postgres" -v ON_ERROR_STOP=1 -f tests/sql/phase02a-security-suite.sql
  ```
- **Exit Code**: `0`
- **Detailed Assertions**:
  1. **Profile Self-Promotion Denied**: Resident `UPDATE public.profiles SET role='management'` rejected with `'Profile assignments are protected'`.
  2. **Estate / Building / Unit Assignment Tampering Denied**: Modifications to `assigned_estate_id`, `assigned_building_id`, and `unit_number` rejected with `'Profile assignments are protected'`. Permitted fields (`full_name`, `phone_number`) update cleanly.
  3. **Unassigned User Isolation**: Authenticated user with `assigned_estate_id IS NULL` receives `0` rows on `buildings`, `service_zones`, `facilities`, `incident_reports`, and `published_incident_bulletins`. Report submission rejected.
  4. **Report Initialization & Scope**: Reports cannot start in `reviewed` or `linked` status; forged `reporter_id` rejected; zones outside the report building rejected.
  5. **Cross-Estate Management Denied**: Manager A cannot read or mutate Building B zones; cross-estate update affects `0` rows via RLS.
  6. **Facility Scope & Category Matching**: Incident cannot link facility belonging to another building or incompatible category (e.g. lift on water incident).
  7. **Unverified Incident Publication Denied**: `incident_updates` with `is_published = true` rejected while incident is `investigating`.
  8. **Attribution & Timestamp Immutability**: Verification stamps `verified_by = auth.uid()` and `verified_at = now()`. Spoofed `published_by` and `published_at` in bulletin updates are strictly overwritten by actual session actor and `transaction_timestamp()`.
  9. **Restoration Guard**: Moving to `restored` requires physical verification evidence (minimum 5 characters).
  10. **Atomic Report Linking**: Linking report to incident transitions report to `linked` atomically.
  11. **Resident Read Model Sanitization**: Residents cannot read private domain tables (`incidents`, `incident_updates`, `maintenance_tasks`, `audit_events`). Published bulletins contain strictly sanitized fields (no `internal_notes`, `restoration_evidence`, `verified_by`, `published_by`, `reporter_id`).
  12. **Client Bulletin Mutation Denied**: Direct client `UPDATE` on `published_incident_bulletins` rejected with `permission denied`.
  13. **Unpublishing Projection Purge**: Setting `is_published = false` purges bulletin from `published_incident_bulletins` immediately.
  14. **Audit Immutability & Rollback Safety**: Audit rows generated automatically; client mutations on `audit_events` denied; transactional rollback on failed mutation leaves zero orphan audit rows.

---

## 6. API and Private Storage Test Results

Executed via [tests/api-and-storage.test.mjs](file:///c:/Dev/ppr-nadi/tests/api-and-storage.test.mjs) against live Kong API gateway (`http://127.0.0.1:64321`) using real HS256 authenticated JWTs:

| # | Check Description | Protocol / Endpoint | Identity | HTTP Status | Verdict |
| :--- | :--- | :--- | :--- | :---: | :---: |
| 1 | Anonymous access denied | `GET /rest/v1/incident_reports` | Anonymous | `401` / `0` rows | **PASSED** |
| 2 | Report creation | `POST /rest/v1/incident_reports` | Resident A | `201 Created` | **PASSED** |
| 3 | Resident isolation | `GET /rest/v1/incident_reports?id=eq.<id>` | Resident B | `200` (`[]` empty) | **PASSED** |
| 4 | Cross-estate manager isolation | `GET /rest/v1/incident_reports?id=eq.<id>` | Manager B | `200` (`[]` empty) | **PASSED** |
| 5 | Estate manager read access | `GET /rest/v1/incident_reports?id=eq.<id>` | Manager A | `200` (1 row) | **PASSED** |
| 6 | Anonymous storage upload | `POST /storage/v1/object/incident-evidence/...` | Anonymous | `400` / `401` | **PASSED** |
| 7 | Cross-resident storage upload | `POST /storage/v1/object/incident-evidence/...` | Resident B | `400` / `403` | **PASSED** |
| 8 | Upload to unowned report path | `POST /storage/v1/object/incident-evidence/...` | Resident A | `400` / `403` | **PASSED** |
| 9 | Valid synthetic PNG upload | `POST /storage/v1/object/incident-evidence/...` | Resident A | `200 OK` | **PASSED** |
| 10 | Attachment metadata verification | `POST /rest/v1/report_attachments` | Resident A | `400` (tampered) / `201` (matched) | **PASSED** |
| 11 | 3-attachment limit enforcement | `POST /rest/v1/report_attachments` | Resident A | `201` (3rd) / `400` (4th rejected) | **PASSED** |
| 12 | Storage download authorization | `GET /storage/v1/object/authenticated/...` | Resident A, Mgr A | `200 OK` | **PASSED** |
| 13 | Storage download denied | `GET /storage/v1/object/authenticated/...` | Resident B, Mgr B | `400` / `403` (Denied) | **PASSED** |
| 14 | Storage unsupported mutation (DELETE) | `DELETE /storage/v1/object/incident-evidence/...`| Resident A | `400` / `403` (Denied) | **PASSED** |
| 15 | Direct private incident query | `GET /rest/v1/incidents` | Resident A | `200` (`[]` empty) | **PASSED** |
| 16 | Direct private updates query | `GET /rest/v1/incident_updates` | Resident A | `200` (`[]` empty) | **PASSED** |
| 17 | Bulletin client write denied | `POST /rest/v1/published_incident_bulletins` | Resident A | `403 Forbidden` | **PASSED** |

**Summary**: 26 of 26 HTTP & Storage assertions **PASSED**.

---

## 7. Concurrency and Rollback Results

Executed via [tests/concurrency.test.mjs](file:///c:/Dev/ppr-nadi/tests/concurrency.test.mjs) utilizing concurrent interactive PostgreSQL client sessions:

| Scenario | Concurrency Mechanism | Observed Behavior | Final State | Verdict |
| :--- | :--- | :--- | :--- | :---: |
| **Simultaneous Report Linking** | `FOR UPDATE` lock on `incident_reports` + unique constraint | Session 1 acquired lock and linked report. Session 2 blocked; upon unblocking, rejected with `'Link requires reviewed report'`. | Exactly 1 link row, status `'linked'`, exactly 1 audit record. | **PASSED** |
| **Concurrent Attachment Race** | `PERFORM 1 FROM incident_reports FOR UPDATE` in `guard_attachment()` | Two sessions raced to insert 3rd attachment. Transactions serialized; Session 1 committed 3rd attachment; Session 2 re-evaluated count, rejected with `'Maximum three evidence attachments per report'`. | Exactly 3 attachments persisted; 4th attachment prevented. | **PASSED** |
| **Competing State Transitions** | Transition state machine check in `guard_incident()` | Session 1 transitioned `investigating` $\to$ `confirmed`. Session 2 attempted competing transition directly to `restored` and was rejected. | Incident preserved `confirmed` status; `verified_by` stamped to Manager A. | **PASSED** |
| **Publication & Incident Sync** | `sync_bulletin()` + `sync_incident_bulletins()` triggers | Concurrent publication of update and incident advancement to `in_maintenance`. | Bulletin projection synchronized with current status `in_maintenance`. | **PASSED** |

**Summary**: 7 of 7 concurrency assertions **PASSED**.

---

## 8. Regression Command Results

All project validation commands executed and reported:

| Command | Exit Code | Diagnostics & Output | Verdict |
| :--- | :---: | :--- | :---: |
| `npm run lint` | `0` | 0 errors, 0 warnings. ESLint passed cleanly. | **PASSED** |
| `npx --no-install tsc --noEmit` | `0` | Zero TypeScript compilation errors. | **PASSED** |
| `npm test` | `0` | 3 test files passed, 19 of 19 unit tests passed (0 failures). | **PASSED** |
| `npm run build` | `0` | Next.js 16.4.2 Turbopack production build compiled in 579ms; all 10 routes prerendered successfully. | **PASSED** |

---

## 9. Comprehensive Check Status Table

| Area | Check Item | Status |
| :--- | :--- | :---: |
| **Prerequisites** | Supabase CLI (`v2.116.0`), Docker (`v29.8.1`), PostgreSQL Client (`18.6`) | **PASSED** |
| **Environment** | Dedicated project identity (`ppr-nadi`) with custom ports (`64321`–`64329`) | **PASSED** |
| **Migrations** | All 4 migrations applied in timestamp order without errors | **PASSED** |
| **Profile Security** | Self-promotion, cross-estate reassignment, unit tampering denied | **PASSED** |
| **Domain Integrity** | Submitted status required, zone matching, facility building/category matching | **PASSED** |
| **Cross-Estate RLS** | Residents and managers strictly isolated to assigned estates | **PASSED** |
| **Incident Lifecycle** | Investigating $\to$ Confirmed (verified actor) $\to$ Maintenance $\to$ Restored (evidence) | **PASSED** |
| **Read Model** | Physical `published_incident_bulletins` projection contains zero private columns | **PASSED** |
| **Audit Trails** | Same-transaction audit logging, client mutation denied, zero orphan audit rows | **PASSED** |
| **Storage RLS** | Path-based evidence ownership, metadata matching, 3-file limit, read isolation | **PASSED** |
| **Concurrency** | Report link serialization, attachment limit race condition locking | **PASSED** |
| **Regression** | Lint (0/0), TypeScript (0 errors), Vitest (19/19), Next.js Build (10/10 routes) | **PASSED** |

---

## 10. Remaining Risks and Architectural Decisions

1. **Physical Bulletin Read Model**: The decision to use a physical table (`published_incident_bulletins`) updated via triggers rather than a `SECURITY DEFINER` view completely shields private domain tables from resident `GRANT`s. Triggers must continue to synchronize any future status fields.
2. **Storage Object Soft Deletion**: Currently, `DELETE` and `UPDATE` on `storage.objects` are deliberately disallowed for authenticated users to maintain chain-of-custody evidence integrity. Any future report withdrawal workflow must use explicit management archiving rather than direct file deletion.
3. **Local Dev Container Lifecycle**: The local containers run on custom port `64322` via `supabase/config.toml`. When running local development servers in subsequent phases, `.env.local` must target `http://127.0.0.1:64321` and DB port `64322`.

---

## 11. Readiness Declaration for Phase 02B

The database foundation, Row Level Security policies, storage bucket configurations, and transaction integrity mechanisms have been verified against a live PostgreSQL 15 engine under real authenticated identities.

**VERDICT: THE DATABASE FOUNDATION IS VERIFIED AND READY FOR PHASE 02B.**
*(Phase 02B will implement authentication integration, persistent report submission, management review, verified publication, resident live view, and audit history.)*
