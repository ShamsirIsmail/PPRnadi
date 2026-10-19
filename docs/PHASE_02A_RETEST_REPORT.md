# PPR NADI — Phase 02A Database Validation and Security Retest Report

**Date**: 2026-10-17  
**Workspace**: `C:\Dev\ppr-nadi`  
**Target Environment**: Isolated Local Supabase (Container: `supabase_db_ppr-nadi`, PostgreSQL 15.8)  
**Status**: REMEDIATION COMPLETE — ALL SUITES STRICT, DETERMINISTIC & PASSING

---

## 1. Executive Summary

Following the independent Codex audit and verification of the initial Phase 02A remediation, all findings—including the final two requirements for reliable storage metadata cleanup and actual overlapping concurrent publication/status tests—have been resolved:

1. **Storage Cleanup Reliability**: The concurrency runner now generates and tracks explicit UUIDs for storage metadata fixtures. During cleanup, it executes scoped deletion using `storage.allow_delete_query = true`, verifies that the exact created objects are deleted, and confirms that database counts for `storage.objects`, `auth.users`, `public.profiles`, and `public.buildings` return exactly to their pre-run baseline. Pre-existing records remain untouched.
2. **Concurrent Overlapping Publication & Status Verification**: Two independent PostgreSQL sessions test overlapping transactions with confirmed database lock observation. Check 5A verifies that an uncommitted status update (`NO KEY UPDATE`) blocks concurrent bulletin publication (`FOR SHARE` in `guard_update`). Check 5B verifies that an uncommitted bulletin publication (`FOR SHARE`) blocks a concurrent incident status update (`NO KEY UPDATE`). In both orderings, upon commit of the winning transaction, the competing transaction unblocks and completes, leaving `published_incident_bulletins.incident_status === incidents.status === 'in_maintenance'`.
3. **Reproducible SQL & API Suites**: Both SQL suites and the real Supabase Auth/PostgREST/Storage suite remain strictly reproducible and passing with zero tolerance for HTTP 500.

All regression checks (`lint`, `tsc`, unit tests, production build) pass with exit code 0.

---

## 2. Verified Non-Secret Target Identity

Before executing database or API interactions, target identity was validated to guarantee isolation:

- **Local PostgreSQL Instance**: `127.0.0.1:64322` (Container: `supabase_db_ppr-nadi`, PostgreSQL 15.8)
- **Local Supabase API Gateway**: `http://127.0.0.1:64321` (Kong Gateway)
- **Local Supabase Studio**: `http://127.0.0.1:64323`
- **Isolation Check**: The separate local project (`harmony-health-management` on ports `54321`–`54327`) was confirmed untouched.
- **Fail-Closed Verification**: The test runners verify that the hostname is `127.0.0.1` or `localhost` on port `64321`/`64322`, halting immediately if unverified or remote.

---

## 3. Exact Files Modified

1. [`tests/concurrency.test.mjs`](file:///C:/Dev/ppr-nadi/tests/concurrency.test.mjs):
   - Added explicit tracking of storage metadata fixture UUIDs (`trackedStorageIds`).
   - Placed the entire setup, execution, and verification lifecycle inside a protected `try { ... } finally { ... }` block.
   - Cleaned up storage metadata fixtures using session configuration `SET storage.allow_delete_query = true;` scoped strictly to `trackedStorageIds`.
   - Added thorough post-cleanup assertions checking that `storage.objects`, `auth.users`, `profiles`, and `buildings` return exactly to baseline counts, failing closed with a nonzero exit code if any delta is detected.
   - Retained sequential synchronization checks as **Check 4A & 4B**.
   - Added actual concurrent overlapping transaction synchronization checks as **Check 5A & 5B** using two active `PsqlSession` instances and `pg_locks` barrier coordination.
   - Corrected container verification label to `supabase_db_ppr-nadi`.

2. [`tests/sql/phase01b-security.sql`](file:///C:/Dev/ppr-nadi/tests/sql/phase01b-security.sql):
   - Dynamic identifiers (`\gset`, `:run_token`, dynamic UUIDs) to prevent fixture collision.
   - Executed under `-v ON_ERROR_STOP=1`.

3. [`tests/sql/phase02a-security-suite.sql`](file:///C:/Dev/ppr-nadi/tests/sql/phase02a-security-suite.sql):
   - Dynamic fixtures and strict rollback test checking exact error `'Invalid incident transition'` and verifying unchanged pre/post state.

4. [`tests/api-and-storage.test.mjs`](file:///C:/Dev/ppr-nadi/tests/api-and-storage.test.mjs):
   - Real Supabase Auth sessions (no mock JWTs), 74 strict assertions, zero HTTP 500 tolerance.

5. [`docs/PHASE_02A_RETEST_REPORT.md`](file:///C:/Dev/ppr-nadi/docs/PHASE_02A_RETEST_REPORT.md):
   - Updated documentation reflecting the final two fixes, execution evidence, and readiness status.

---

## 4. Codex Findings & Resolutions

| # | Codex Finding | Remediation Resolution | Status |
|---|---|---|---|
| **1** | False-positive API assertions accepted HTTP 500 as security enforcement | Removed all acceptance of 5xx. Tests strictly assert expected HTTP 400/401/403 and verify structured PostgreSQL error codes (`P0001`, `42501`) and Storage errors (`EntityTooLarge`, `InvalidMimeType`). Unexpected 5xx fails the test immediately. | **RESOLVED** |
| **2** | SQL suites failed on rerun with `duplicate key value violates unique constraint "users_pkey"` | Parameterized SQL suites using `\gset` dynamic identifiers and unique run tokens. Suites run with `ON_ERROR_STOP=1` and execute inside transactions with rollback. Proven repeatable by running both suites twice consecutively without error. | **RESOLVED** |
| **3** | Concurrency tests used `ON_ERROR_STOP=0`, lacked structured verification and relied on race timings | Implemented deterministic coordination via `pg_locks` observation. Concurrency checks assert that exactly one transaction succeeds, the other fails with the exact expected error, and no partial state or orphan audit records persist. | **RESOLVED** |
| **4** | API test script manually signed mock JWTs | Implemented end-to-end authentication via Supabase Auth: creates synthetic users via Auth Admin API, provisions profiles, signs in via `/auth/v1/token?grant_type=password`, and uses real access tokens for all API and Storage operations. Zero credentials logged. | **RESOLVED** |
| **5** | Storage and API coverage incomplete | Expanded `tests/api-and-storage.test.mjs` to 74 assertions covering unassigned user denial, signed URL creation and bearer download, >5MB rejection, disallowed MIME type rejection, 4th attachment cap, storage immutability (denied PUT overwrite and DELETE), and direct private table read rejection. | **RESOLVED** |
| **6** | Rollback assertion caught any exception indiscriminately | Replaced catch-all block with strict validation asserting the exact error `'Invalid incident transition'`, confirming the exception occurred, and verifying pre- and post-business, bulletin, and audit states are completely unchanged. | **RESOLVED** |
| **7** | Concurrency test leaked 4 storage metadata fixtures (`storage.objects` increased from 24 to 28) | Generated explicit fixture UUIDs; implemented scoped deletion using `storage.allow_delete_query = true`; verified baseline count return (28 before run -> 28 after run, delta = 0); cleanup failures treated as hard failures. | **RESOLVED** |
| **8** | Publication/status sync was only tested sequentially, lacking overlapping transaction proof | Added Check 5A and Check 5B testing both transaction orderings with confirmed database locks (`NO KEY UPDATE` vs `FOR SHARE`), proving blocking relationships, transaction completion, and atomic bulletin synchronization. | **RESOLVED** |

---

## 5. Detailed Concurrency & Lock Coordination Evidence

### A. Structure and Distinctions

The suite distinguishes between:
- **Sequential Synchronization Tests (Checks 4A & 4B)**: Validate business trigger propagation when operations occur in sequence (Status first vs. Publication first) on single connections.
- **Concurrent Overlapping Tests (Checks 5A & 5B)**: Validate row locking, transaction isolation, and barrier coordination across two simultaneous PostgreSQL sessions (`Sync5-Status` and `Sync5-Publish`).

### B. Lock Coordination Mechanism

In PostgreSQL, `public.guard_update()` enforces:
```sql
SELECT * INTO incident FROM public.incidents WHERE id = NEW.incident_id FOR SHARE;
```
Meanwhile, an `UPDATE public.incidents SET status = ...` acquires a `NO KEY UPDATE` lock on the incident row.
In the PostgreSQL lock matrix, `FOR SHARE` and `NO KEY UPDATE` are mutually exclusive.

### C. Check 5A: Concurrent Ordering A (Status Holds Lock, Publication Competes)

1. **Session 1** begins transaction and updates incident:
   ```sql
   UPDATE public.incidents SET status = 'in_maintenance' WHERE id = '${inc5A}';
   ```
   Holds transaction open with `NO KEY UPDATE` row lock.
2. **Session 2** begins transaction and attempts bulletin publication:
   ```sql
   INSERT INTO public.incident_updates (id, incident_id, update_title, message_bm, stage, is_published)
   VALUES ('${upd5A}', '${inc5A}', 'Notis Overlap A', '...', 'contractor_assigned', true);
   ```
3. **Lock Barrier Verified**: `waitForLock(s5A2.backendPid)` queries `pg_locks` and confirms Session 2 is waiting on Session 1's lock (`granted = false`).
4. **Commit & Unblock**: Session 1 commits. Session 2 unblocks, acquires `SHARE` lock, reads committed incident status (`in_maintenance`), inserts into `published_incident_bulletins`, and commits.
5. **Outcome**:
   - `incidents.status`: `'in_maintenance'`
   - `published_incident_bulletins.incident_status`: `'in_maintenance'`
   - Notice published audit event verified.

### D. Check 5B: Concurrent Ordering B (Publication Holds Lock, Status Competes)

1. **Session 1** begins transaction and publishes bulletin:
   ```sql
   INSERT INTO public.incident_updates (id, incident_id, update_title, message_bm, stage, is_published)
   VALUES ('${upd5B}', '${inc5B}', 'Notis Overlap B', '...', 'contractor_assigned', true);
   ```
   Trigger `guard_update` acquires `FOR SHARE` row lock on incident. Holds transaction open.
2. **Session 2** begins transaction and attempts incident status update:
   ```sql
   UPDATE public.incidents SET status = 'in_maintenance' WHERE id = '${inc5B}';
   ```
3. **Lock Barrier Verified**: `waitForLock(s5B2.backendPid)` confirms Session 2 is blocked waiting for Session 1's `SHARE` lock to release.
4. **Commit & Unblock**: Session 1 commits. Session 2 unblocks, executes status update, trigger `incident_bulletin_sync` automatically cascades to `published_incident_bulletins`, and Session 2 commits.
5. **Outcome**:
   - `incidents.status`: `'in_maintenance'`
   - `published_incident_bulletins.incident_status`: `'in_maintenance'` (synchronized by cascade)
   - Notice published audit event verified.

---

## 6. Test Execution Results

### A. Concurrency Suite (Consecutive Runs)

Executed via `node tests/concurrency.test.mjs` against `127.0.0.1:64322`.

| Check Group | Scenarios Tested | Assertions |
|---|---|---|
| **Check 1** | Simultaneous Report Linking (Winner/Loser, Row Lock, Audit Integrity) | 8 |
| **Check 2** | Concurrent Attachment Race at 3-File Limit (Cap Error, Row Lock) | 5 |
| **Check 3** | Competing Incident State Transitions (Row Lock, Valid Transition Winner) | 5 |
| **Check 4A** | Sequential Sync: Status Updated Before Publication | 2 |
| **Check 4B** | Sequential Sync: Published Bulletin Cascaded on Status Update | 4 |
| **Check 5A** | Concurrent Overlapping Sync: Status Holds Lock, Publication Blocked | 9 |
| **Check 5B** | Concurrent Overlapping Sync: Publication Holds Lock, Status Blocked | 9 |
| **Total** | | **42 assertions** |

- **Run 1**: **42 / 42 PASSED (Exit code 0)**
- **Run 2**: **42 / 42 PASSED (Exit code 0)**

### B. Cleanup Verification & Resource Invariance

The runner measures database resources before and after each run:

| Resource Table | Baseline Count | Pre-Run Count | Post-Cleanup Count | Net Delta |
|---|---|---|---|---|
| `storage.objects` | 28* | 28 | 28 | **0** |
| `auth.users` | 7 | 7 | 7 | **0** |
| `public.profiles` | 7 | 7 | 7 | **0** |
| `public.buildings` | 8 | 8 | 8 | **0** |
| `public.published_incident_bulletins` | 0 | 0 | 0 | **0** |
| `public.audit_events` (run estate) | 0 | 0 | 0 | **0** |

*\*Note on Historical Leftovers: Baseline `storage.objects` is 28, comprising 24 initial test records plus 4 historical metadata records created during an earlier uncleaned iteration. Per requirements, historical records were left intact and recorded separately. Each new test run inserts exactly 4 tracked records and cleans up exactly those 4 records, maintaining zero net change.*

### C. Other Test Suites

| Suite | Scope | Result |
|---|---|---|
| `tests/sql/phase01b-security.sql` | SQL Security Baseline (2 consecutive runs) | **PASS (Exit code 0)** |
| `tests/sql/phase02a-security-suite.sql` | SQL Expanded Security Suite (2 consecutive runs) | **PASS (Exit code 0)** |
| `tests/api-and-storage.test.mjs` | Real Auth Sessions, PostgREST API & Storage (74 assertions) | **PASS (Exit code 0)** |

---

## 7. Regression Validation

All project verification commands were executed in sequence:

| Command | Result | Details |
|---|---|---|
| `npm run lint` | **PASS (Exit code 0)** | ESLint clean (0 errors, 0 warnings). |
| `npx --no-install tsc --noEmit` | **PASS (Exit code 0)** | TypeScript type check clean. |
| `npm test` | **PASS (Exit code 0)** | Vitest unit tests: 3 test files, 19 unit tests passed. |
| `npm run build` | **PASS (Exit code 0)** | Next.js 16.4.2 (Turbopack) production build completed; 12 static pages generated. |

*Unit test count (19 Vitest tests) remains strictly separate from integration test totals (74 API/Storage assertions, 42 Concurrency assertions).*

---

## 8. Remaining Limitations & Scope Clarification

1. **Automated Test Scope**: Passing automated tests confirm that PostgreSQL RLS policies, trigger constraints, and storage authorization function as designed under local test conditions. They do not constitute formal security certification or compliance.
2. **Phase Boundary**: The database foundation, storage policies, and transaction concurrency rules are verified. The Next.js application frontend remains a static preview and does not yet contain real authentication, database persistence, or Realtime subscriptions.

---

## 9. Readiness Recommendation for Phase 02B

All Phase 02A requirements and remediation findings are **COMPLETE AND VERIFIED**.

- Test suites are deterministic, non-destructive, and repeatable.
- Resource cleanup leaves no residual fixtures or metadata behind.
- Transaction concurrency and lock contention are proven under real PostgreSQL execution.

**Recommendation**: Await independent Codex review. Proceed to Phase 02B upon authorization.
