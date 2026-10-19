# PPR NADI

Civic Atlas prototype for community infrastructure reporting in Malaysian public housing.

Current UI uses synthetic data. Authentication, report persistence and Realtime are not implemented. Unsupported write actions are disabled. Do not connect private production records to these preview routes.

## Local development

Use the locked dependencies already present, or `npm ci` when setting up an approved development environment. Run `npm run dev` and open the displayed local address.

Checks: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`.

Next.js 16.4.2 requires Node >=20.9.0. The Phase 01B audit used Node 24.18.1/npm 11.16.0; production builds currently fail at Turbopack CSS worker startup. See [fix report](docs/PHASE_01B_FIX_REPORT.md) for exact verification results and diagnostics.

## Database

SQL migrations were revised for a fresh Supabase project but have **not been applied or runtime-tested**. Do not execute them without explicit approval. Follow [the database test procedure](docs/PHASE_01B_DATABASE_TEST_PROCEDURE.md) in a disposable test project after architectural review.

The next milestone is the authenticated resident-report → management-verification → official-update vertical slice. Resource optimisation and a full digital twin remain deferred.
