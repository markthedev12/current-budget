# Current

Current is a shared household budget focused on the time between today and the next paycheck. This checkout is the web application and backend for the private Sites preview.

## What it does

- Each signed-in person has a separate identity. A household owner can add one partner by sign-in email. The recipient explicitly joins or declines, and can switch between households without merging their budgets.
- The bridge view shows cash available after bills and a chosen minimum cushion, an estimated daily allowance, and the lowest projected balance.
- Planned bills and income can repeat weekly, every two weeks, or monthly. Recording an occurrence creates a ledger transaction and removes that occurrence from the remaining forecast.
- Pending entries reduce available cash while reconciliation compares the cleared ledger to the bank's posted balance. Transfers create two linked entries, so moving money between accounts does not change the household total.
- Sinking funds reserve part of the recorded cash for irregular expenses. The bridge excludes reserved money from safe to spend without changing bank balances.
- The bridge highlights projected cushion breaches and includes a what-if rescue planner for extra income or a later bill date. These scenarios do not change the actual plan.
- Weekly check-ins capture a shared note, acknowledgements, and a safe-to-spend snapshot. The check-in screen shows new entries and upcoming items.
- Bank CSV import previews up to 200 rows, supports common date and amount columns, and skips rows from a file that has already been imported. It never imports until the user reviews and confirms.
- The activity ledger supports search and filters for category, account, and bank status. Ordinary transactions can be edited without losing their identity. Expenses can be split into two to ten category entries only when the split total exactly matches the original purchase; the original entry stays archived for traceability.
- Households can create up to 25 custom spending categories, assign monthly limits, and use them in manual entries, imports, edits, and splits. A category cannot be removed while an active transaction still uses it.
- Account balances are derived from a starting balance and ledger entries. Reconciliation appends an explicit adjustment and a dated record; it never silently rewrites past transactions.
- Every household document has a version. A stale save returns a conflict instead of overwriting a partner's change.
- Light/dark preference is kept on each device. Household financial data is stored in D1.
- The first browser-only prototype's data or an exported backup can be imported into an empty household. Imports are opt-in.

## Current architecture

- Vinext/React for the web interface.
- Cloudflare Worker API routes. The private Site uses ChatGPT sign-in identity supplied by Sites. A configured Amazon Cognito user pool uses hosted sign-up/sign-in with authorization code and PKCE, verified ID tokens, and HTTP-only session cookies.
- D1 for households, members, and versioned budget documents. The document format and calculations are in `lib/budget.ts`.
- Drizzle generates the schema migration in `drizzle/`; API routes use prepared D1 statements.

The private Sites access policy is separate from household membership. An invited partner needs both access to the Site and a membership row with the same sign-in email. The Cognito path is dormant until all four environment variables are set: `COGNITO_ISSUER`, `COGNITO_DOMAIN`, `COGNITO_CLIENT_ID`, and `COGNITO_REDIRECT_URI`. The redirect URI must end in `/auth/callback`. Configure a public client with authorization code grant, PKCE, the `openid email profile` scopes, self sign-up, and verified email in Cognito. The app accepts only signed RS256 ID tokens with the expected issuer, client ID, token use, and verified email.

Do not switch the live couple Site to Cognito until its existing membership IDs have been migrated or the couple has exported their budget. Existing ChatGPT identities are deliberately not auto-linked to Cognito identities just because an email matches. Keep the Site's private audience while testing the account flow. A public launch also needs a public audience/host, account deletion and retention rules, a privacy policy, recovery and support flows, and load/abuse testing. Invitation email delivery is not built; the recipient must sign in with the invited email to see the in-app invitation. The current web page alone is not an iOS app.

## Development

Install with pnpm, generate a migration when `db/schema.ts` changes, and build before applying the generated migration to a local D1 preview. The Sites skill's build and packaging scripts produce the Cloudflare Worker artifact. Do not place real bank credentials or user financial data in source or environment files.

## Web release order

1. Provision the Cognito user pool and app client; set the four environment variables in a staging deployment and verify sign-up, login, refresh, logout, password reset, and two-person household isolation.
2. Migrate the existing couple identities with an explicit verified procedure. Preserve their D1 budget and take a backup first.
3. Add self-service account deletion, a privacy policy, invitation delivery, operational monitoring, and support. Run security and concurrency tests using separate accounts.
4. Open the Site to a public audience only after the above gates pass. Gather real usage and fix budgeting friction before beginning the mobile client. Share budget calculations and API contracts with that client.

## Next candidates

1. Account-specific forecasts and bill payment accounts.
2. Edit planned series, with explicit handling for one occurrence versus the full series.
3. Optional notifications for cushion breaches and upcoming bill dates. The current alert is in the app.
4. Debt payoff scenarios and subscription price tracking.
5. Bank sync only after manual entry, CSV matching, and reconciliation feel reliable.
