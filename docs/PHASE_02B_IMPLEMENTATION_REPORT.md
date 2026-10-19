# PPR NADI — Phase 02B Final Migration Concurrency Validation & Implementation Report

**Milestone:** Phase 02B Final Migration Concurrency Validation & Negative Reservation Closure  
**Workspace:** `C:\Dev\ppr-nadi`  
**Execution Date:** 2026-10-17  
**Target Environment:** Local Dedicated Supabase (`ppr-nadi` / `supabase_db_ppr-nadi`, API `http://127.0.0.1:64321`, DB `127.0.0.1:64322`, Dev Server `http://127.0.0.1:3000`)  
**Status:** COMPLETE & INDEPENDENTLY VERIFIED  
- Action Integration Suite: **29 / 29 PASS (verified earlier)**  
- Browser Workflow Suite: **10 / 10 scenarios PASS (verified earlier)**  
- Real Browser Response-Loss Suite: **PASS (Run 1 & Run 2 verified earlier)**  
- Unit Test Suite: **19 / 19 PASS**  
- TypeScript Compilation: **0 errors (`tsc --noEmit`)**  
- ESLint: **0 errors, 0 warnings (`npm run lint`)**  
- Disposable Migration Concurrency Validation: **100% PASS (Run 1 & Run 2 consecutive runs verified)**  
- Baseline Demo Preservation: **100% intact: 2 demo accounts, 30 storage objects, 10 reports, 12 attachments**  
- Active Demo Database State: **Recovery lease migration remains strictly UNAPPLIED to demo database (`postgres`)**

---

## 1. Executive Summary & Verification Gaps Resolved

This milestone completes all remaining validation coverage in the disposable database without modifying the active demo database, expanding features, or altering UI:

| Gap / Objective | Root Cause & Resolution | Status |
| :--- | :--- | :--- |
| **1. Real Overlapping Concurrency Testing** | Built a multi-session concurrency harness using two independent PostgreSQL sessions (`S1` and `S2`) connected via dedicated stdio pipes. In each case, S1 holds an open transaction, S2 begins a competing operation, explicit lock blocking is asserted via `SELECT pg_blocking_pids(...)`, S1 is deliberately committed, and S2 unblocks with the verified serial outcome. Tested 4 distinct scenarios (competing reservations at capacity, reservation vs attachment commitment without double counting, management review holds report lock first, evidence operation holds report lock first). Triggers remain active. | **RESOLVED & VERIFIED (4/4 OVERLAPPING CONCURRENCY PASS)** |
| **2. Negative Reservation Tests** | Added 12 rigorous negative attachment registration tests (Assertions 13a–13l). Every scenario provisions valid Storage catalog fixtures to isolate and prove the reservation check: no reservation, expired reservation, wrong report, wrong owner, wrong path, wrong filename, wrong MIME, wrong size, invalid reservation state (`expired`), and reviewed/linked/dismissed reports. Asserted SQLSTATE `42501`, verified no attachment inserted, and verified residents cannot directly mark committed or alter paths. | **RESOLVED & VERIFIED (12/12 NEGATIVE TESTS PASS)** |
| **3. Rollback Behavioral Integrity** | Extracted exact rollback SQL from proposal documentation, executed it in the disposable database, and verified actual runtime behavior (not just table absence): original `attachment_guard` restores, accepts valid unreserved attachments, enforces report ownership (`42501`), validates storage catalog metadata, and enforces the original 3-attachment limit. | **RESOLVED & VERIFIED (BEHAVIORAL ROLLBACK PASS)** |
| **4. Strict Target Safety & Preservation** | Enforces `127.0.0.1:64322`, verifies project domain identity via `public.profiles.assigned_estate_id` and `public.buildings.estate_id` (`ppr-sentosa-demo`), checks demo accounts, checks `incident-evidence` bucket, and verifies 0 leases in demo db. Drops run-owned disposable database cleanly in `finally`. Fingerprints before and after show zero alteration to the active demo environment. | **RESOLVED & VERIFIED (ZERO DEMO MUTATIONS)** |

---

## 2. Test Architecture & Scope Distinction

To maintain clear technical boundaries across tests, the test harnesses are explicitly distinguished:

1. **Overlapping Transaction Tests (Step 11):**
   - Two concurrent PostgreSQL sessions (`S1`, `S2`) interacting in real time via interactive `psql` stdio streams.
   - Observes blocking via `pg_blocking_pids()` while S1 holds row locks (`FOR UPDATE` or `UPDATE` row lock on `incident_reports`).
   - Does not rely on `Promise.all` or arbitrary sleeps; relies on deterministic PostgreSQL kernel lock inspection.
   - Triggers and constraints remain fully enabled.
2. **Sequential Guard Tests (Steps 7, 8, 9, 10):**
   - Direct SQL executions checking backfills, boundary conditions, RLS enforcement, table privilege restrictions, maintenance role execution, and conflict idempotency.
3. **SQL Storage-Catalog Fixtures:**
   - In PostgreSQL, foreign key / metadata validation occurs against `storage.objects`. These fixtures are synthetic rows in `storage.objects` created to satisfy catalog lookups so negative tests isolate the database reservation guard.
4. **Actual Storage API & Browser Tests (Verified Earlier):**
   - E2E tests (`tests/browser-workflow.mjs` and `tests/browser-response-loss.mjs`) interacting with the live Supabase Storage S3 REST API (`127.0.0.1:64321`) and real Google Chrome browser sessions with live byte uploads and Playwright route abortion.
5. **No Cross-System Atomicity Claim:**
   - Supabase Storage (S3 REST API) and PostgreSQL are decoupled systems without 2-phase commit (2PC). Database-level reservation leases prevent internal PostgreSQL quota bypasses, but cannot guarantee distributed atomicity across external S3 and PostgreSQL.

---

## 3. Exact Files Changed

1. **`scripts/validate-migration-proposal.mjs`** *(Updated)*
   - Added interactive `PsqlSession` child process management for interactive session coordination over stdio.
   - Added `waitForBlocking(watcher, blockedPid)` using `SELECT pg_blocking_pids(...)`.
   - Updated project verification to validate `ppr-sentosa-demo` identity across `profiles` and `buildings` (reflecting actual schema structure without separate `estates` table).
   - Added 12 comprehensive negative reservation tests (Assertions 13a–13l) asserting SQLSTATE `42501` and absence of side effects.
   - Added 4 real overlapping concurrency scenarios (Concurrency Tests A, B, C, D) observing real PID blocking relationships.
   - Expanded rollback verification to test functional runtime behavior of the restored original `attachment_guard`.
   - Removed unused declarations and formatted code for clean ESLint execution.
2. **`docs/PHASE_02B_RECOVERY_MIGRATION_PROPOSAL.md`** *(Updated)*
   - Updated Section 8 with the comprehensive matrix of sequential tests, negative reservation assertions, maintenance permissions, real overlapping concurrency tests with `pg_blocking_pids()`, and behavioral rollback validation.
3. **`docs/PHASE_02B_IMPLEMENTATION_REPORT.md`** *(Updated)*
   - Documented the exact execution evidence, blocking relationships, PID traces, negative assertion details, and preservation fingerprints.

---

## 4. Real Overlapping Concurrency Coordination Evidence

Validated with two independent interactive PostgreSQL sessions (`S1` and `S2`) connected to the disposable database (`ppr_nadi_migval_*`):

### Concurrency Test A: Competing Reservations at Capacity
- **Scenario:** Report with 2 pre-existing occupied slots (1 registered attachment + 1 committed reservation). Only 1 slot remains free. Two concurrent requests attempt to reserve the final slot.
- **Session 1 (PID 81873):** Opens transaction, executes `SELECT reserve_evidence_slot(...)`, acquiring `FOR UPDATE` lock on report row. Keeps transaction open.
- **Session 2 (PID 81874):** Executes competing `SELECT reserve_evidence_slot(...)`.
- **Observed Blocking:** S2 immediately blocks. Test watcher queries `SELECT pg_blocking_pids(81874)::text` and observes:
  ```
  ✓ Observed lock blocking: pg_blocking_pids(81874) = {81873}
  ```
- **Resolution:** S1 commits transaction. S2 unblocks and is strictly rejected:
  ```
  ERROR: 42501: Maksimum 3 slot bukti dibenarkan bagi setiap laporan
  ```
- **Outcome:** Exactly 1 reservation persisted; total reservations + attachments = 3 (cap strictly enforced).

### Concurrency Test B: Reservation vs Attachment Commitment (No Double-Counting)
- **Scenario:** Report with 1 registered attachment and 1 active reservation (`leaseB1`). Total occupied slots = 2. Exactly 1 slot remains free.
- **Session 1 (PID 81873):** Opens transaction, registers attachment for `leaseB1`, transitioning lease from `reserved` to `committed`. Holds transaction open.
- **Session 2 (PID 81874):** Races a new reservation for the remaining slot (`leaseB2`).
- **Observed Blocking:** S2 blocks on report row lock held by S1:
  ```
  ✓ Observed lock blocking: pg_blocking_pids(81874) = {81873}
  ```
- **Resolution:** S1 commits attachment insert. S2 unblocks and successfully reserves the 3rd slot without double-counting the transitioning lease.
- **Outcome:** Exactly 2 registered attachments + 1 active reservation = 3 total slots; zero duplicate attachments.

### Concurrency Test C: Management Review Holds Report Lock First
- **Scenario:** Report in `submitted` status with 1 active reservation held by resident. Manager reviews report while resident attempts attachment.
- **Session 1 (Manager, PID 81873):** Executes `UPDATE incident_reports SET status = 'reviewed' WHERE id = ...` in an open transaction, holding row lock.
- **Session 2 (Resident, PID 81874):** Attempts `INSERT INTO report_attachments ...`.
- **Observed Blocking:** S2 blocks on row lock held by Manager:
  ```
  ✓ Observed lock blocking: pg_blocking_pids(81874) = {81873}
  ```
- **Resolution:** Manager commits review update. Resident unblocks and is strictly rejected by `guard_attachment_with_lease()` trigger:
  ```
  ERROR: 42501: Cannot attach evidence to report in status "reviewed"
  ```
- **Outcome:** Report remains `reviewed`; zero attachments inserted; business workflow respected.

### Concurrency Test D: Evidence Operation Holds Report Lock First
- **Scenario:** Report in `submitted` status with 1 active reservation. Resident registers attachment while Manager attempts review.
- **Session 1 (Resident, PID 81873):** Executes `INSERT INTO report_attachments ...` in an open transaction, holding row lock.
- **Session 2 (Manager, PID 81874):** Attempts `UPDATE incident_reports SET status = 'reviewed' ...`.
- **Observed Blocking:** S2 (Manager) blocks on row lock held by Resident:
  ```
  ✓ Observed lock blocking: pg_blocking_pids(81874) = {81873}
  ```
- **Resolution:** Resident commits attachment registration. Manager unblocks and successfully completes status update to `reviewed`.
- **Outcome:** Serial ordering preserved; report is `reviewed` and registered evidence is safely retained.

---

## 5. Negative Reservation Test Suite Results (Assertions 13a–13l)

All tests provisioned matching `storage.objects` catalog fixtures to ensure failure was strictly caused by the database reservation check:

| Test | Assertion Tested | Role | Expected SQLSTATE | Outcome | Verified Error Reason & System State |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **13a** | **No reservation** | `authenticated` | `42501` | **PASS** | Rejected: `Evidence registration requires a valid active reservation lease`. 0 attachments inserted. |
| **13b** | **Expired reservation** | `authenticated` | `42501` | **PASS** | Lease expired (`expires_at < now()`): rejected. Lease status remains `reserved` (not committed). 0 attachments inserted. |
| **13c** | **Wrong report ID** | `authenticated` | `42501` | **PASS** | Attachment report != lease report: rejected. Lease not committed. |
| **13d** | **Wrong owner** | `authenticated` | `42501` | **PASS** | Foreign resident insert rejected by ownership verification (`42501`). |
| **13e** | **Wrong storage path** | `authenticated` | `42501` | **PASS** | Storage path mismatch between attachment and lease rejected (`42501`). |
| **13f** | **Wrong filename** | `authenticated` | `42501` | **PASS** | Filename mismatch rejected (`42501`). |
| **13g** | **Wrong MIME type** | `authenticated` | `42501` | **PASS** | MIME type mismatch rejected (`42501`). |
| **13h** | **Wrong file size** | `authenticated` | `42501` | **PASS** | File size mismatch rejected (`42501`). |
| **13i** | **Invalid reservation state (`expired`)** | `authenticated` | `42501` | **PASS** | Lease with `status = 'expired'` rejected (`42501`). |
| **13j** | **Report already reviewed** | `authenticated` | `42501` | **PASS** | Attachment rejected: `Cannot attach evidence to report in status "reviewed"`. |
| **13k** | **Report already linked** | `authenticated` | `42501` | **PASS** | Attachment rejected: `Cannot attach evidence to report in status "linked"`. |
| **13l** | **Report already dismissed** | `authenticated` | `42501` | **PASS** | Attachment rejected: `Cannot attach evidence to report in status "dismissed"`. |
| **12** | **Direct Resident Manipulation** | `authenticated` | `42501` | **PASS** | Residents denied direct UPDATE on status, identity, or expiry by table privileges (`42501`). |

---

## 6. Rollback Behavioral Validation Results

Executed against the disposable database after all migration tests:
1. Rollback SQL drops `evidence_recovery_leases`, triggers, and proposal functions.
2. Restores the original `attachment_guard` trigger and function from `20261016160300_storage_evidence_bucket.sql`.
3. Tested runtime behavior:
   - Valid attachments inserted without leases succeed under original rules.
   - Original ownership verification still rejects foreign resident inserts with `42501`.
   - Original storage metadata validation still rejects mismatched `storage.objects` records.
   - Original 3-attachment limit continues to operate cleanly.

---

## 7. Consecutive Execution Runs & Preservation Fingerprints

### Consecutive Migration Validation Runs (`npm run test:migration`):
- **Run 1:** Executed against disposable DB `ppr_nadi_migval_1792236599561_fa0cdf51`. All assertions passed; disposable DB dropped cleanly; exit code `0`.
- **Run 2:** Executed against disposable DB `ppr_nadi_migval_1792236609495_285dd783`. All assertions passed; disposable DB dropped cleanly; exit code `0`.

### Tooling Quality Checks:
- `npm run lint`: **0 errors, 0 warnings**
- `npx --no-install tsc --noEmit`: **0 errors**
- `npm test`: **19 / 19 passed**

### Active Demo Database Preservation Fingerprint:
Inspected directly on `127.0.0.1:64322/postgres` before and after all runs:
```
         metric         | count | verification status
------------------------+-------+---------------------
 demo_users             |     2 | INTACT (resident@sentosa.local, manager@sentosa.local)
 storage_objects        |    30 | INTACT (incident-evidence bucket)
 reports_count          |    10 | INTACT (incident_reports table)
 attachments_count      |    12 | INTACT (report_attachments table)
 lease_table_in_demo_db |     0 | PROPOSAL STRICTLY UNAPPLIED TO DEMO DB
```

---

## 8. Summary of Deferred Work & Next Steps

1. **Active Demo Database:**
   The migration proposal remains strictly **UNAPPLIED** to the active local demo database (`postgres` on port `64322`).
2. **Next Phase:**
   Phase 03 mobile camera integration with native `capture="environment"` and distinct gallery picker buttons remains deferred.
3. **Status:**
   STOP for independent Codex review.
