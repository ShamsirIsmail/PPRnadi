# Phase 01B database verification procedure

Status: **UNVERIFIED — no migrations or SQL tests were executed.**

## Approval and environment

1. Obtain explicit migration/test execution approval after architectural review.
2. Use a fresh, disposable local Supabase project with no real users/data. Do not use production credentials. Revised migrations are a fresh-schema baseline, not an upgrade path for an existing deployment.
3. Review all four migrations in timestamp order. Apply together using the approved Supabase CLI workflow (`supabase db reset` only against that disposable local project). This is destructive to the selected test database; check its identity first. Do not serve an API between core schema and security migration application.
4. Connect `psql` as the local database administrator and run `psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/phase01b-security.sql`. Use a locally supplied test-only connection string; do not paste it into reports or commit it. The test script wraps fixtures in BEGIN/ROLLBACK and must stop on the first assertion failure.
5. Record CLI/PostgreSQL/Supabase versions, database identity, migration output, assertion output and final rollback. Failure is not a pass; repair and rerun only in the approved test environment.

## Included SQL cases

The SQL harness creates two estates and four synthetic auth identities. Under `SET LOCAL ROLE authenticated` and session-local JWT claims it checks:

- Own-profile role/estate/building reassignment is rejected.
- Forged report status and a zone from another building are rejected.
- Own submitted report succeeds; another resident and another estate's manager cannot see it.
- Management scope does not cross estates; cross-estate UPDATE affects zero rows.
- Facility/building mismatch and out-of-range zone floors fail.
- Unverified publication fails; confirmed verification stamps the actual actor/time.
- Report linking requires compatible scope and updates the report atomically.
- Publication stamps the actual actor/time and creates a resident-readable sanitized row.
- Residents cannot read internal incident/update rows after publication, mutate the read model, or access other-estate notices.
- Skipped/backward restoration transitions and missing evidence fail.
- Valid restoration and maintenance changes create audit rows.
- Client audit inserts/deletes fail.
- Foreign/missing report evidence paths and metadata without an uploaded object fail.

These are authored integration assertions, **not passing test results**. Vitest does not execute `.sql` files.

## Additional required API/storage/concurrency tests

After SQL assertions pass, use separate resident A, resident B, manager A and manager B JWTs with the public API key (never service-role for authorization tests). Repeat denial cases through PostgREST and confirm anonymous access is denied. Confirm an authenticated identity without a profile cannot access domain data. Test profile self-insertion with forged assignments and trusted provisioning separately.

Using the Storage API, upload a small real JPEG to `{residentA}/{ownedReport}/tap.jpg`. Insert matching attachment metadata using actual API-returned MIME/size; confirm download/signed URL issuance works only for its owner and estate-A management. Test wrong user prefix, wrong report UUID, wrong metadata path, MIME/size mismatch, 5MB limit, fourth attachment, cross-estate management, anonymous requests and disabled overwrites/deletes. A signed URL is a bearer token until expiry; use short lifetimes. Storage object insertion alone does not validate image contents; inspect actual uploads and decide the Phase 02 decoding/EXIF policy before real evidence is accepted.

Use concurrent sessions to test duplicate links, fourth-attachment races, simultaneous incident transitions and publish/restoration locking. Confirm failed mutations leave no audit/read-model changes. Verify publication edits/unpublishing update or remove sanitized rows in the same transaction, and incident restoration refreshes published status. Review all existing `storage.objects` policies: permissive policies from other applications can widen access.

Realtime publication/subscriptions and real login do not exist yet. Configure and test them in Phase 02 against only the sanitized read model; do not publish private incident tables to residents.
