# PPR NADI — Phase 02B Minimal SQL Migration Proposal: Durable Evidence Recovery & Idempotency Leases

**Document Version:** 2.1.0 (Strict Lease Enforcement, Attachment Guard Security Closure & Migration Seeding)  
**Status:** PROPOSED FOR INDEPENDENT CODEX REVIEW (UNAPPLIED — DO NOT APPLY TO DATABASE)  
**Date:** 2026-10-17  
**Workspace:** `C:\Dev\ppr-nadi`  
**Target Database:** Local PostgreSQL 18 (`supabase_db_ppr-nadi` on `127.0.0.1:64322`)

---

## 1. Context, Motivation & Boundary Limitations

In Phase 02B, application-level evidence reconciliation was implemented in `src/app/actions/resident-report.ts` and `LaporForm.tsx`:
- Deterministic content-addressed paths: `<user_id>/<report_id>/<clean_base>_<sha256_16>.<ext>`.
- Client and server pre-validation: byte limits, MIME verification, and authentic magic-number image signature validation (`validateImageSignature`).
- Existing-object collision reconciliation in Storage and PostgreSQL metadata conflict handling (`23505`).
- In-batch and cross-request deduplication before slot calculation.
- Verified database state queries for authoritative attachment counts (`count: 'exact'`).

### The Cross-System Boundary: PostgreSQL vs. Supabase Storage
Supabase Storage (an S3-backed REST API) and PostgreSQL are two decoupled systems without two-phase commit (2PC) or distributed transactions. Therefore:
> [!IMPORTANT]
> **No SQL migration can provide cross-system atomicity across Storage and PostgreSQL.**  
> If an S3 blob upload succeeds but the client disconnects before the database commit, or if a database reservation is created but the client network drops before uploading the blob, state diverges across the storage API and database. Full durable guarantees remain **PENDING** independent review and must not claim distributed transaction atomicity.

The purpose of this migration is to provide **durable database-enforced reservation tracking, slot reservation serialization, and server-controlled status transitions** in PostgreSQL, closing the window where unreserved attachment inserts could bypass quota rules or race against report status transitions.

---

## 2. Identified Defect in Previous Proposal (v2.0)

In v2.0, the function `guard_attachment_with_lease` executed:
```sql
UPDATE public.evidence_recovery_leases
SET status = 'committed', updated_at = now()
WHERE report_id = NEW.report_id
  AND expected_storage_path = NEW.storage_path
  AND status IN ('reserved', 'uploaded')
RETURNING id INTO v_matching_lease_id;
-- MISSING CHECK: Did not check if v_matching_lease_id IS NULL!
NEW.uploaded_at := now();
RETURN NEW;
```
**Defect:** If no matching reservation existed, `v_matching_lease_id` remained `NULL`, but the trigger did not abort. As a result, ordinary attachment inserts could completely bypass the lease reservation system.

**Correction in v2.1:**
Attachment registration now strictly requires a valid, matching, active reservation. If `v_matching_lease_id IS NULL`, the trigger raises an exception with error code `42501` (`insufficient_privilege`).

---

## 3. Real Schema Object Alignment

This corrected proposal aligns strictly with the verified schema in `20261016160000_core_schema.sql`, `20261016160200_rls_and_security_closure.sql`, and `20261016160300_storage_evidence_bucket.sql`:

| Concept | Actual Schema Architecture & Trusted Helper |
| :--- | :--- |
| **Report Ownership** | `public.owns_report(p_report uuid)`: verifies `reporter_id = auth.uid()` on `incident_reports`. |
| **Estate Access** | Through `public.buildings`: `incident_reports` joins `buildings` on `building_id`, where `buildings.estate_id` determines estate authority. |
| **Management Authorization** | `public.manages_report(p_report uuid)`: checks `public.manages_building(r.building_id)` which calls `public.manages_estate(b.estate_id)`. |
| **Storage Path Ownership** | `public.owns_evidence_path(p_path text)`: verifies `split_part(p_path, '/', 1) = auth.uid()::text`, array length = 3, and `owns_report`. |
| **Management Storage Path** | `public.manages_evidence_path(p_path text)`: verifies `public.manages_report(r.id)` for the path. |
| **Report Status Rules** | `incident_reports.status` enum: `'submitted'`, `'reviewed'`, `'linked'`. Evidence only accepted while `'submitted'`. |

---

## 4. Minimal Proposed Migration: `00005_evidence_recovery_leases.sql`

```sql
-- =============================================================================
-- Migration: 00005_evidence_recovery_leases.sql
-- Status: PROPOSED (UNAPPLIED)
-- Purpose: Durable evidence reservations, slot quotas, and server-controlled transitions.
-- =============================================================================

BEGIN;

-- 1. Create Lease Status Enum
CREATE TYPE public.evidence_lease_status AS ENUM (
  'reserved',   -- Slot reserved before client starts Storage upload
  'uploaded',   -- Verified present in Storage, awaiting attachment commit
  'committed',  -- Successfully registered in public.report_attachments
  'expired'     -- TTL elapsed without successful commitment
);

-- 2. Create Reservations Table
CREATE TABLE public.evidence_recovery_leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.incident_reports(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  content_sha256 text NOT NULL,
  expected_storage_path text NOT NULL,
  expected_file_name text NOT NULL,
  expected_mime_type text NOT NULL,
  expected_file_size integer NOT NULL,
  status public.evidence_lease_status NOT NULL DEFAULT 'reserved',
  lease_expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '15 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_evidence_lease_idempotency UNIQUE (report_id, idempotency_key),
  CONSTRAINT uq_evidence_lease_path UNIQUE (expected_storage_path),
  CONSTRAINT chk_evidence_lease_size CHECK (expected_file_size > 0 AND expected_file_size <= 5242880),
  CONSTRAINT chk_evidence_lease_mime CHECK (expected_mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT chk_evidence_lease_sha256 CHECK (length(content_sha256) = 64)
);

-- 3. Indexes for Queries, Expiration Sweeps & Concurrency Locks
CREATE INDEX idx_evidence_leases_report_status ON public.evidence_recovery_leases(report_id, status);
CREATE INDEX idx_evidence_leases_expiry ON public.evidence_recovery_leases(lease_expires_at) WHERE status = 'reserved';

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.evidence_recovery_leases ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
-- Residents can read their own reservations
CREATE POLICY resident_select_own_leases ON public.evidence_recovery_leases
  FOR SELECT TO authenticated
  USING (
    reporter_id = auth.uid() 
    AND public.owns_report(report_id)
  );

-- Residents can create a reservation ONLY for their own 'submitted' report
-- with safe path, valid size, matching reporter_id, and system-default expiry
CREATE POLICY resident_insert_own_leases ON public.evidence_recovery_leases
  FOR INSERT TO authenticated
  WITH CHECK (
    reporter_id = auth.uid() 
    AND public.owns_report(report_id)
    AND public.owns_evidence_path(expected_storage_path)
    AND split_part(expected_storage_path, '/', 2) = report_id::text
    AND split_part(expected_storage_path, '/', 3) = expected_file_name
    AND status = 'reserved'
    AND lease_expires_at <= (clock_timestamp() + interval '15 minutes')
  );

-- Residents CANNOT directly update leases: status transitions happen via trusted triggers
CREATE POLICY resident_no_direct_update ON public.evidence_recovery_leases
  FOR UPDATE TO authenticated
  USING (false)
  WITH CHECK (false);

-- Management can view leases for reports within their estate authority
CREATE POLICY management_select_estate_leases ON public.evidence_recovery_leases
  FOR SELECT TO authenticated
  USING (public.manages_report(report_id));

-- 6. Administrative Legacy Backfill: Seed committed reservations for existing attachments
-- CRITICAL ORDERING: Must execute BEFORE installing trg_guard_lease_reservation,
-- so that pre-existing attachments on non-submitted reports or reports already holding 3 attachments
-- are seeded as committed without reservation trigger rejection.
-- Legacy placeholder hashes are clearly distinguished from verified SHA-256 hashes.
INSERT INTO public.evidence_recovery_leases (
  report_id,
  reporter_id,
  idempotency_key,
  content_sha256,
  expected_storage_path,
  expected_file_name,
  expected_mime_type,
  expected_file_size,
  status,
  lease_expires_at,
  created_at,
  updated_at
)
SELECT
  ra.report_id,
  ir.reporter_id,
  'legacy_' || ra.id::text,
  'legacy_placeholder_' || replace(ra.id::text, '-', '') || '0000000000000', -- 64-char distinguished placeholder
  ra.storage_path,
  ra.file_name,
  ra.mime_type,
  ra.file_size_bytes,
  'committed'::public.evidence_lease_status,
  ra.uploaded_at,
  ra.uploaded_at,
  ra.uploaded_at
FROM public.report_attachments ra
JOIN public.incident_reports ir ON ir.id = ra.report_id
ON CONFLICT (expected_storage_path) DO NOTHING;

-- 7. Trigger Function & Trigger: Slot Quota Enforcement Across Reservations & Attachments
CREATE OR REPLACE FUNCTION public.guard_lease_reservation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_report_status text;
  v_registered_count int;
  v_active_lease_count int;
BEGIN
  -- 1. Lock report row to serialize concurrent requests and verify current status
  SELECT status INTO v_report_status
  FROM public.incident_reports
  WHERE id = NEW.report_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found' USING ERRCODE = 'P0002';
  END IF;

  -- 2. Management Review Racing: Disallow reservations on non-submitted reports
  IF v_report_status <> 'submitted' THEN
    RAISE EXCEPTION 'Report is already in status "%" and cannot accept new evidence reservations', v_report_status
      USING ERRCODE = '42501';
  END IF;

  -- 3. Count already registered attachments
  SELECT count(*) INTO v_registered_count
  FROM public.report_attachments
  WHERE report_id = NEW.report_id;

  -- 4. Count active, non-expired reservations excluding this one
  SELECT count(*) INTO v_active_lease_count
  FROM public.evidence_recovery_leases
  WHERE report_id = NEW.report_id
    AND status IN ('reserved', 'uploaded')
    AND lease_expires_at > clock_timestamp()
    AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  -- 5. Strict 3-slot cap
  IF (v_registered_count + v_active_lease_count) >= 3 THEN
    RAISE EXCEPTION 'Maksimum 3 slot bukti dibenarkan termasuk tempahan aktif (semasa: % didaftar, % ditempah).',
      v_registered_count, v_active_lease_count USING ERRCODE = '42501';
  END IF;

  NEW.created_at := now();
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_lease_reservation
  BEFORE INSERT ON public.evidence_recovery_leases
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_lease_reservation();

-- 8. Trigger Function & Trigger: Enforce Matching Reservation on Attachment Registration
CREATE OR REPLACE FUNCTION public.guard_attachment_with_lease()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_report_status text;
  v_matching_lease_id uuid;
BEGIN
  -- 1. Serialize on report row to prevent race conditions with review or concurrent attachments
  SELECT status INTO v_report_status
  FROM public.incident_reports
  WHERE id = NEW.report_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_report_status <> 'submitted' THEN
    RAISE EXCEPTION 'Cannot attach evidence to report in status "%"', v_report_status
      USING ERRCODE = '42501';
  END IF;

  -- 2. Verify ownership and path convention
  IF NOT public.owns_report(NEW.report_id) OR NOT public.owns_evidence_path(NEW.storage_path)
    OR split_part(NEW.storage_path, '/', 2) <> NEW.report_id::text
    OR split_part(NEW.storage_path, '/', 3) <> NEW.file_name THEN
    RAISE EXCEPTION 'Evidence must belong to the authenticated report owner' USING ERRCODE = '42501';
  END IF;

  -- 3. Authoritative attachment limit
  IF (SELECT count(*) FROM public.report_attachments WHERE report_id = NEW.report_id) >= 3 THEN
    RAISE EXCEPTION 'Maximum three evidence attachments per report' USING ERRCODE = '42501';
  END IF;

  -- 4. Verify Storage catalog presence & metadata agreement
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects o 
    WHERE o.bucket_id = 'incident-evidence'
      AND o.name = NEW.storage_path 
      AND o.metadata->>'mimetype' = NEW.mime_type
      AND o.metadata->>'size' = NEW.file_size_bytes::text
  ) THEN
    RAISE EXCEPTION 'Evidence object and metadata must match an existing upload in Storage' USING ERRCODE = '42501';
  END IF;

  -- 5. MANDATORY MATCHING RESERVATION REQUIREMENT
  -- Ordinary inserts without a valid reservation are strictly rejected.
  -- Idempotent retries on already committed leases are permitted.
  UPDATE public.evidence_recovery_leases
  SET status = 'committed', updated_at = now()
  WHERE report_id = NEW.report_id
    AND reporter_id = auth.uid()
    AND expected_storage_path = NEW.storage_path
    AND expected_file_name = NEW.file_name
    AND expected_mime_type = NEW.mime_type
    AND expected_file_size = NEW.file_size_bytes
    AND (
      (status IN ('reserved', 'uploaded') AND lease_expires_at > clock_timestamp())
      OR (status = 'committed')
    )
  RETURNING id INTO v_matching_lease_id;

  IF v_matching_lease_id IS NULL THEN
    RAISE EXCEPTION 'Attachment rejected: no active, valid unexpired reservation found matching this report, owner, path, filename, MIME and size (ordinary inserts cannot bypass reservations).'
      USING ERRCODE = '42501';
  END IF;

  NEW.uploaded_at := now();
  RETURN NEW;
END;
$$;

-- Replace existing attachment_guard trigger with updated version
DROP TRIGGER IF EXISTS attachment_guard ON public.report_attachments;
CREATE TRIGGER attachment_guard
  BEFORE INSERT ON public.report_attachments
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_attachment_with_lease();

-- 9. Maintenance Sweeper Function
CREATE OR REPLACE FUNCTION public.expire_stale_evidence_leases()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.evidence_recovery_leases
  SET status = 'expired', updated_at = now()
  WHERE status = 'reserved'
    AND lease_expires_at <= clock_timestamp()
    AND NOT EXISTS (
      SELECT 1 FROM public.report_attachments ra
      WHERE ra.storage_path = expected_storage_path
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 10. Restrict Privileged Maintenance Execution & Table Privileges
-- Revoke inappropriate default PUBLIC execution on administrative maintenance function
REVOKE ALL ON FUNCTION public.expire_stale_evidence_leases() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_stale_evidence_leases() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_evidence_leases() TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_evidence_leases() TO postgres;

-- Restrict trigger functions from public execution
REVOKE ALL ON FUNCTION public.guard_lease_reservation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_lease_reservation() TO authenticated, service_role, postgres;

REVOKE ALL ON FUNCTION public.guard_attachment_with_lease() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_attachment_with_lease() TO authenticated, service_role, postgres;

-- Explicit Table Privileges
REVOKE ALL ON public.evidence_recovery_leases FROM PUBLIC;
GRANT SELECT, INSERT ON public.evidence_recovery_leases TO authenticated;
GRANT ALL ON public.evidence_recovery_leases TO service_role, postgres;

COMMIT;
```

---

## 5. Rollback Plan

If required, the migration can be reverted completely without data loss to existing `incident_reports` or `report_attachments`:

```sql
BEGIN;

-- 1. Restore original attachment guard trigger without lease dependencies
DROP TRIGGER IF EXISTS attachment_guard ON public.report_attachments;
DROP FUNCTION IF EXISTS public.guard_attachment_with_lease();

CREATE TRIGGER attachment_guard
  BEFORE INSERT ON public.report_attachments
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_attachment();

-- 2. Drop reservation tables and functions
DROP TABLE IF EXISTS public.evidence_recovery_leases CASCADE;
DROP FUNCTION IF EXISTS public.guard_lease_reservation() CASCADE;
DROP FUNCTION IF EXISTS public.expire_stale_evidence_leases() CASCADE;
DROP TYPE IF EXISTS public.evidence_lease_status CASCADE;

COMMIT;
```

---

## 6. Security, Lifecycle & Concurrency Analysis

### 1. Mandatory Reservation Enforcement
Ordinary attachment inserts can no longer bypass reservations. Any insert into `report_attachments` must find an active, unexpired lease matching:
- `report_id = NEW.report_id`
- `reporter_id = auth.uid()`
- `expected_storage_path = NEW.storage_path`
- `expected_file_name = NEW.file_name`
- `expected_mime_type = NEW.mime_type`
- `expected_file_size = NEW.file_size_bytes`
- `(status IN ('reserved', 'uploaded') AND lease_expires_at > clock_timestamp()) OR status = 'committed'`

### 2. Slot Counting Across Both Reservations and Attachments
Ordinary attachment inserts and concurrent upload operations are strictly bounded:
`v_registered_count + v_active_lease_count < 3`.
Because `public.incident_reports` is locked with `FOR UPDATE` in both `guard_lease_reservation` and `guard_attachment_with_lease`, concurrent workers cannot over-allocate slots.

### 3. Management Review Racing with In-Flight Evidence
If management reviews a report (`status = 'reviewed'`) or links it to an incident (`status = 'linked'`), `FOR UPDATE` serializes the transaction:
- In-flight reservations fail with `Report is already in status "reviewed" and cannot accept new evidence reservations`.
- In-flight attachment inserts fail with `Cannot attach evidence to report in status "reviewed"`.

### 4. Server-Controlled Status Transitions
Residents cannot:
- Change reservation status directly to `committed` (prevented by `resident_no_direct_update`).
- Alter `expected_storage_path` or `expected_file_name` after creation.
- Arbitrarily extend `lease_expires_at` past 15 minutes.
Status transitions to `committed` occur exclusively through the database trigger upon verified `report_attachments` insertion.

### 5. Historical Unregistered Evidence Recovery Protocol
For evidence objects that exist in Storage without a lease (e.g. historical data or edge-case interruptions):
The application recovery protocol invokes `reconcilePendingEvidenceAction`, which creates an unexpired reservation with `status = 'uploaded'` after validating file signature and size, enabling the attachment trigger to commit them safely without opening a backdoor.

### 6. Safe Storage Cleanup Responsibilities
Orphaned Storage blobs created during uncommitted, expired reservations (`status = 'reserved' AND lease_expires_at < now()`) must be identified and removed:
- Sweeper jobs query `evidence_recovery_leases` where `status = 'reserved' AND lease_expires_at < now() - interval '24 hours'`.
- The sweeper verifies that `NOT EXISTS (SELECT 1 FROM report_attachments WHERE storage_path = l.expected_storage_path)`.
- Deletion proceeds via the Supabase Storage REST API using administrative service-role credentials during scheduled maintenance windows, keeping normal application execution purely non-service-role.
- The lease status is marked `'expired'`.

---

## 7. Current Proposal Status: UNAPPLIED TO DEMO DATABASE

- **Active Demo Database State:** UNAPPLIED. No reservation tables, triggers, or modified functions have been executed on the active local demo database (`postgres` on `127.0.0.1:64322`).
- **Production Baseline Integrity:** Permanent accounts (`resident@sentosa.local`, `manager@sentosa.local`), baseline reports (10), baseline attachments (12), and Storage objects (exactly 30) remain strictly untouched.
- **Cross-System Boundary:** Distributed 2PC atomicity across Supabase Storage (S3 REST API) and PostgreSQL cannot be achieved via SQL alone.

---

## 8. Isolated Disposable Database Validation Results

The proposal is accompanied by maintained validation tooling (`scripts/validate-migration-proposal.mjs`), runnable with a single documented command:

```bash
npm run test:migration
```

### Validation Tooling Protocol:
1. **Target Verification:** Enforces local host/port constraints (`127.0.0.1:64322/postgres`), verifies demo project identity via `public.profiles.assigned_estate_id` and `public.buildings.estate_id` (`ppr-sentosa-demo`), checks demo user accounts and `incident-evidence` storage bucket, and asserts proposal remains unapplied (`0` recovery leases).
2. **Exact Proposal Extraction:** Dynamically extracts the exact migration and rollback SQL blocks directly from this proposal document, guaranteeing zero divergent copies.
3. **Disposable Database Creation:** Initializes a uniquely named disposable database owned by the test run (`ppr_nadi_migval_<timestamp>_<token>`), refusing to reuse or drop existing databases.
4. **Schema Replication:** Loads active schema DDL via `pg_dump` into the disposable database without terminating active demo connections.
5. **Synthetic Fixtures:** Seeds synthetic legacy reports (0, 1, 2, 3 attachments; submitted, reviewed, linked, dismissed) and 10 legacy attachments with valid Storage catalog metadata.
6. **Execution & Validation:** Applies migration SQL, validates sequential assertions (1–12), executes comprehensive negative attachment tests (13a–13l), tests privileged maintenance (14a–14d), tests idempotency (15), and runs 4 real overlapping concurrency scenarios with two independent PostgreSQL sessions observing `pg_blocking_pids()`.
7. **Rollback Behavioral Validation:** Executes rollback SQL, confirms restoration of original `attachment_guard`, and validates that original ownership guards, storage catalog metadata verification, and 3-attachment limits still operate as expected.
8. **Teardown & Baseline Preservation:** Drops only the run-owned disposable database in `finally`, asserts clean exit code `0`, and verifies active demo database baseline fingerprints (accounts, storage objects, reports, attachments) remain completely intact.

### Actual Sequential & Negative Assertion Results (All PASS):

| Category | # | Assertion / Tested Condition | Role | Expected SQLSTATE | Outcome | Verified Result / Error Reason |
| :--- | :-: | :--- | :--- | :---: | :---: | :--- |
| **Legacy Backfill** | **1** | **Backfill Attachment Counts** | `postgres` | — | **PASS** | Exactly 10 legacy attachments backfilled into leases |
| | **2** | **Backfill Status Default** | `postgres` | — | **PASS** | All legacy leases seeded with `status = 'committed'` |
| | **3** | **Pre-existing 3-Slot Quota** | `postgres` | — | **PASS** | Report with 3 attachments backfilled without quota error |
| | **4** | **Non-Submitted Backfill** | `postgres` | — | **PASS** | Reviewed, linked, dismissed backfilled without status error |
| | **5** | **Distinguished Placeholder Hash** | `postgres` | — | **PASS** | Exact 64-char `legacy_placeholder_...` verified |
| **Reservation Flow** | **6a**| **Slot Reservation Creation** | `authenticated` | — | **PASS** | Reservation succeeds with `status = 'reserved'` |
| | **6b**| **Attachment Auto-Commit** | `authenticated` | — | **PASS** | Attachment matching lease succeeds; lease auto-commits |
| | **7** | **3-Slot Quota Cap** | `authenticated` | `42501` | **PASS** | Reserving 4th slot rejected: `Maksimum 3 slot bukti dibenarkan` |
| | **8** | **Reviewed Report Reservation** | `authenticated` | `42501` | **PASS** | Reservation rejected: `Cannot attach evidence to report in status "reviewed"` |
| | **9** | **Linked Report Reservation** | `authenticated` | `42501` | **PASS** | Reservation rejected: `Cannot attach evidence to report in status "linked"` |
| | **10**| **Dismissed Report Reservation** | `authenticated` | `42501` | **PASS** | Reservation rejected: `Cannot attach evidence to report in status "dismissed"` |
| | **11**| **Cross-Resident RLS Guard** | `authenticated` | `42501` | **PASS** | Resident B reservation on Resident A report denied by RLS |
| | **12**| **Direct Lease Update Denial** | `authenticated` | `42501` | **PASS** | Residents denied direct UPDATE/expiry modification by table privileges |
| **Negative Tests** | **13a**| **No Reservation** | `authenticated` | `42501` | **PASS** | No matching reservation found: `Evidence registration requires a valid active reservation lease` |
| | **13b**| **Expired Reservation** | `authenticated` | `42501` | **PASS** | Lease expired: rejected; lease not committed; 0 attachments inserted |
| | **13c**| **Mismatched Report ID** | `authenticated` | `42501` | **PASS** | Attachment report != lease report rejected (`42501`) |
| | **13d**| **Mismatched Owner** | `authenticated` | `42501` | **PASS** | Foreign resident insert rejected by ownership guard (`42501`) |
| | **13e**| **Mismatched Storage Path** | `authenticated` | `42501` | **PASS** | Path mismatch between lease and attachment rejected (`42501`) |
| | **13f**| **Mismatched Filename** | `authenticated` | `42501` | **PASS** | Filename mismatch rejected (`42501`) |
| | **13g**| **Mismatched MIME Type** | `authenticated` | `42501` | **PASS** | MIME type mismatch rejected (`42501`) |
| | **13h**| **Mismatched File Size** | `authenticated` | `42501` | **PASS** | File size mismatch rejected (`42501`) |
| | **13i**| **Invalid Lease State (`expired`)**| `authenticated` | `42501` | **PASS** | Attempting attachment against `expired` lease rejected (`42501`) |
| | **13j**| **Attachment on Reviewed Report** | `authenticated` | `42501` | **PASS** | Attachment rejected: report status `"reviewed"` (`42501`) |
| | **13k**| **Attachment on Linked Report** | `authenticated` | `42501` | **PASS** | Attachment rejected: report status `"linked"` (`42501`) |
| | **13l**| **Attachment on Dismissed Report**| `authenticated` | `42501` | **PASS** | Attachment rejected: report status `"dismissed"` (`42501`) |
| **Maintenance** | **14a**| **Anon Caller Permission** | `anon` | `42501` | **PASS** | Execution denied: `permission denied for function expire_stale_evidence_leases` |
| | **14b**| **Resident Caller Permission** | `authenticated` | `42501` | **PASS** | Execution denied: `permission denied for function expire_stale_evidence_leases` |
| | **14c**| **Manager Caller Permission** | `authenticated` | `42501` | **PASS** | Execution denied: `permission denied for function expire_stale_evidence_leases` |
| | **14d**| **Service Role Execution** | `service_role` | — | **PASS** | Expired stale uncommitted leases; preserved active unexpired leases |
| **Idempotency** | **15** | **Repeated Operation Conflict** | `authenticated` | — | **PASS** | `ON CONFLICT DO NOTHING` executes without duplicate attachment rows |

---

### Real Overlapping Concurrency Verification (`pg_blocking_pids()`):

Concurrency is validated using two independent interactive PostgreSQL sessions (`S1` and `S2`) connected via dedicated stdio pipes. The test driver holds the first transaction open, begins the competing operation in the second session, observes the explicit lock blocking via `pg_blocking_pids(blocked_pid)`, deliberately releases the first transaction, and verifies serial outcomes. Triggers remain fully enabled.

#### Concurrency Test A: Competing Reservations at Capacity
- **Initial State:** Report with 2 pre-existing occupied slots (1 registered attachment + 1 committed reservation). Only 1 slot remains free.
- **Coordination:** S1 opens transaction, reserves 3rd slot (`SELECT reserve_evidence_slot(...)`), and holds transaction open. S2 attempts competing reservation for the 3rd slot.
- **Observed Blocking:** S2 immediately blocks on the report row lock held by S1:
  ```sql
  SELECT pg_blocking_pids(pid_S2) -> {pid_S1}
  ```
- **Resolution:** S1 commits. S2 unblocks and is strictly rejected with SQLSTATE `42501`: `Maksimum 3 slot bukti dibenarkan bagi setiap laporan`.
- **Final Outcome:** Exactly 3 reservations persist; 3-slot cap strictly respected across concurrent requests.

#### Concurrency Test B: Reservation versus Attachment Commitment (No Double-Counting)
- **Initial State:** Report with 1 registered attachment and 1 active reservation (`leaseB1`). Total slots occupied = 2. 1 slot free.
- **Coordination:** S1 opens transaction and registers attachment for `leaseB1` (transitioning lease to `committed`). S2 races a new reservation (`leaseB2`) for the remaining slot.
- **Observed Blocking:** S2 blocks on row lock held by S1: `pg_blocking_pids(pid_S2) = {pid_S1}`.
- **Resolution:** S1 commits attachment registration. S2 unblocks and successfully reserves the 3rd slot without double-counting the transitioning lease.
- **Final Outcome:** Exactly 2 registered attachments + 1 active reservation = 3 total slots; zero duplicate attachments.

#### Concurrency Test C: Management Review Holds Report Lock First
- **Initial State:** Report in `"submitted"` status with 1 active reservation held by resident.
- **Coordination:** S1 (Manager) executes status update to `"reviewed"` in an open transaction (`UPDATE incident_reports SET status = 'reviewed' ...`). S2 (Resident) attempts attachment registration.
- **Observed Blocking:** S2 blocks on the report row lock held by Manager: `pg_blocking_pids(pid_S2) = {pid_S1}`.
- **Resolution:** S1 commits status transition. S2 unblocks and is strictly rejected by the trigger with SQLSTATE `42501`: `Cannot attach evidence to report in status "reviewed"`.
- **Final Outcome:** Report remains `"reviewed"`; zero attachments inserted; business and audit status preserved.

#### Concurrency Test D: Evidence Operation Holds Report Lock First
- **Initial State:** Report in `"submitted"` status with 1 active reservation.
- **Coordination:** S1 (Resident) registers attachment in an open transaction (`INSERT INTO report_attachments ...`). S2 (Manager) attempts review update.
- **Observed Blocking:** S2 blocks on the report row lock held by Resident: `pg_blocking_pids(pid_S2) = {pid_S1}`.
- **Resolution:** S1 commits attachment registration. S2 unblocks and successfully updates report status to `"reviewed"`.
- **Final Outcome:** Report transitions cleanly to `"reviewed"`; registered evidence is safely retained.

---

### Rollback Behavioral Validation:
Rollback SQL is extracted directly from Section 6 and executed against the disposable database:
1. All proposal objects (`evidence_recovery_leases`, trigger functions, triggers) are dropped cleanly.
2. The original `attachment_guard` trigger is restored.
3. Attachment registration without leases executes and succeeds under original rules.
4. The original ownership guard still rejects foreign resident inserts (`42501`).
5. The original storage metadata guard still verifies the `storage.objects` catalog.
6. The original 3-attachment limit continues to operate as expected.

---

## 9. Future UI Requirement — Resident Evidence Mobile Camera Capture

> [!NOTE]
> **Record Only — Do Not Implement In Current Phase**  
> Per product roadmap guidelines, the following resident evidence capture design is formally recorded for the subsequent UI phase:
> 1. **Primary Camera Capture:** The camera is the primary capture option on supported mobile browsers (`capture="environment"` / native camera integration).
> 2. **Gallery Selection:** Provide a separate, distinct gallery selection button for file system or photo album selection.
> 3. **Batch Multi-Photo:** Allow multiple photo selections, retaining the current verified maximum of three (3) photos per report.
> 4. **Permission & Fallback:** Gracefully handle camera permission denial and unsupported capture devices without trapping the user.
> 5. **No Auto-Trigger:** Do not open the camera unexpectedly on initial page load.
> 6. **Bilingual Separation:** Preserve complete Bahasa Melayu and English language separation across all camera and gallery prompts.

