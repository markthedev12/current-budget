# Current — Household Budget

A TypeScript/React application for shared household budgeting: accounts and
transactions, recurring plans, a bridge to payday, reconciliation, CSV imports,
and partner review. Source lives in [`current-budget-app/`](current-budget-app/).

## Run locally

Requires Node.js 22.13+ and pnpm 11.19.x.

```sh
cd current-budget-app
pnpm install --frozen-lockfile
pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm exec wrangler d1 migrations apply site-creator-d1 --local --config dist/server/wrangler.json --persist-to .wrangler/state
pnpm dev
```

Open http://localhost:5173. The local adapter supplies a demo identity. See
[local setup](current-budget-app/LOCAL_SETUP.md) and
[application documentation](current-budget-app/README.md) for full feature,
identity, and deployment details. Source export is not a claim of live hosting.

## Architecture

`React/Vinext UI -> Worker API routes -> household membership + version check -> D1`

Pure budget calculations are in `lib/budget.ts`. Integer cents avoid normal
decimal-currency rounding errors; API mutations validate input and use document
versions to detect concurrent edits. Drizzle schema/migrations live under `db/`
and `drizzle/`. Cognito verification is separate from local/Sites identity.

## Verification and security boundaries

`pnpm test` runs dependency-free Node tests for money invariants, pending/voided
entries, transfers and month-end recurring dates. Type checking/builds verify
integration, but do not replace browser QA or multi-user isolation tests.

Outside a trusted Sites host, do not accept caller-supplied identity headers as
authentication. Configure and verify the Cognito flow or a trusted proxy that
strips/replaces those headers. The development identity is only for local work.
Public launch still requires recovery/privacy/retention decisions, account
deletion, abuse controls, deployment verification and operational monitoring.

Never commit real household data, bank credentials, backups, or environment
secrets. No banking sync is implemented. Next: broader API/concurrency tests,
browser verification with two identities, and production readiness work listed
in the application README. Keep changes focused and add regression evidence.
