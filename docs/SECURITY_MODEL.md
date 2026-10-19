# PPR NADI security model — Phase 01B

**Local design only: SQL behavior UNVERIFIED. No migrations applied.**

The UI is a public, synthetic preview. Authentication, PostgreSQL persistence and Realtime are Phase 02 work. Do not connect private data to these unprotected routes.

## Trust and access

- New self-created profiles have resident role and NULL estate/building/unit assignments. Only service-role backend provisioning or a direct trusted database administrator can assign membership or roles. A management JWT cannot change protected assignments.
- Management helpers require an exact trusted estate match. Infrastructure and operational records are scoped through their building/incident/report relationships.
- Residents read their own reports. Raw incidents, internal updates, maintenance and audit rows have no resident SELECT policy.
- `published_incident_bulletins` is a dedicated sanitized table maintained by triggers. Authenticated estate members have SELECT only; anon and client writes have no grant. It contains no reporter identity, staff attribution, internal notes or restoration evidence. It is not a view and does not require resident grants through private-table RLS.
- Published messages are deliberately public-facing text within the estate. Management must avoid putting personal/internal information in that text; schema projection cannot inspect its meaning.

## Invariants and audit

Reports start submitted; only assigned management can move submitted → reviewed/dismissed or reviewed → linked/dismissed. A link requires a reviewed report, a compatible verified active incident and a unique report association; the link updates report status transactionally.

Incidents move investigating → confirmed → in_maintenance → restored → closed. Verification stamps actor/time. Restoration requires physical evidence text; actor is recorded in audit. Verification/restoration attribution cannot be overwritten through ordinary updates. Publication requires verified incident state and stamps the actual publisher/time. A restored bulletin requires a restored/closed incident.

AFTER triggers record report changes, incident verification/restoration, links, updates/publication and maintenance changes in the same database transaction. Audit rows are estate-scoped and read-only to management. Database owners/service-role operators remain trusted and must be operationally controlled.

Reference identities/scopes are immutable through normal updates. Guards enforce zone floor bounds, report/zone building match, incident/facility building and category match, dependency building match, and profile estate/building consistency. Floor-count/scope changes require a reviewed administrative migration.

## Evidence

The bucket stays private with JPEG/PNG/WebP and 5MB limits. Paths must be exactly `{owner UUID}/{owned report UUID}/{filename}`. Owner or assigned-estate management may read; only owner may upload. Attachment creation locks the report, caps metadata at three attachments, checks path/report/filename consistency and verifies the existing object's MIME/size metadata. No client attachment updates/deletes or storage overwrite/delete policies are supplied. Orphan cleanup and retention require Phase 02 design.

## Verification gate

See [database procedure](PHASE_01B_DATABASE_TEST_PROCEDURE.md). Source inspection and unit tests do not establish deployed RLS safety, full security, or PDPA compliance. Supabase API grants, Storage metadata shape, concurrent behavior and signed access need approved integration testing before release.
