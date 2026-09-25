# Current — local repository setup

This export contains the complete source for Current version 8. It does not contain production financial data, credentials, dependencies, generated build output, local database state, or Git history.

## Requirements

- Node.js 22.13 or newer
- pnpm 11.19 or a compatible pnpm 11 release

## Start locally

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm exec wrangler d1 migrations apply site-creator-d1 --local --config dist/server/wrangler.json --persist-to .wrangler/state
pnpm dev
```

Open `http://localhost:5173`. The local Sites adapter supplies a development identity, so Cognito is not required for local development.

If the development server reports that port 5173 is occupied, stop the other process or pass a different port after `pnpm dev --`.

## Important directories

- `app/` — pages, API routes, account flows, and the main budget interface
- `components/` — reusable interface components
- `lib/` — budget calculations and Cognito token verification
- `db/` — Drizzle schema
- `drizzle/` — D1/SQLite migrations
- `public/` — favicon and public assets
- `scripts/` and `build/` — local and Cloudflare/Sites build support

## Optional Cognito configuration

Public account support is dormant unless all four runtime values are supplied:

- `COGNITO_ISSUER`
- `COGNITO_DOMAIN`
- `COGNITO_CLIENT_ID`
- `COGNITO_REDIRECT_URI`

The redirect URI must use `/auth/callback`. Configure Cognito with authorization code grant, PKCE, `openid email profile`, self sign-up, and verified email. Never commit real credentials or user financial data.

## Hosting

The export intentionally has no live Sites project ID. Register it as a new Site or connect it to your own Cloudflare deployment before publishing. The required D1 binding name is `DB`.

## Verification

```bash
pnpm exec tsc --noEmit
pnpm build
```

The original version 8 source commit is `00ba1876d3315bc2984d5c294e27c45f13f42faf`.
