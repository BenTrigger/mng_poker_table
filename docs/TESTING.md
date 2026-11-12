# Testing

Every push runs three jobs in GitHub Actions (`.github/workflows/ci.yml`):

| Job | What it checks | Run locally |
| --- | --- | --- |
| Unit | lint, TypeScript, money math (`src/lib/__tests__`) | `npm test` |
| Database | every migration applies on a fresh Postgres, then full flows as real users with RLS on (`supabase/tests/*.test.sql`) | `npm run test:db` (needs Postgres, `PG*` env vars) |
| Browser | public pages, sign-in redirects, PWA files, mobile layout, no console errors (`e2e/`) | `npm run build && npm run test:e2e` |

`npm run test:e2e:live` runs the browser tests against the live site, including
the Google sign-in redirect.

## Database tests

`supabase/tests/00_supabase_shim.sql` recreates what hosted Supabase provides
(roles, `auth.uid()`, storage, pgcrypto in the `extensions` schema), so the
real migrations run unchanged. Tests switch users with `tests.login('name')`
and assert with `tests.ok / tests.eq / tests.throws / tests.affected`.
Each file runs inside `begin … rollback`.

When you add a feature that touches the database, add its flow to a test file:
the happy path as the right user, and the same action as a user who must be
refused.
