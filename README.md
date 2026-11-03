# Petrol Pump Management System

A web application for admins, customers, and employees to manage petrol and diesel orders, deliveries, customer balances, payments, and indent numbers. The browser interface supports desktop and phone layouts. Flutter and Android are outside the current verification scope.

## Current status

The last completed isolated test run passed 27 of 29 checks: all 17 API checks and 10 browser checks. The complete business workflow passed on desktop and phone emulation. Two session/outage browser checks failed; their causes have been patched, but the subsequent full verification was interrupted. See [the verification report](docs/VERIFICATION.md) for the precise scope and limitations. A final smoke check passed all three role logins over the Wi-Fi hostname, plus customer session and outage recovery. This is a local verification result, not a production-readiness claim.

## Try the isolated local website

Requires Node.js 20.9 or newer, npm, and Docker Compose. Install dependencies with `npm ci` if needed, then run:

```bash
npm run dev:local
```

This starts disposable PostgreSQL and real Supabase Auth services, applies migrations, creates local accounts, and serves the website at http://localhost:3000/login. It preserves existing disposable business records.

For a phone on the same Wi-Fi, use `http://<computer-LAN-IP>:3000/login`. The website listens on all interfaces. Browser requests go through the website, so your phone does not need a separate Auth service URL. See [local credentials](TEST_CREDENTIALS.md).

## Available browser workflows

- Admin: create and edit users, change eligible roles and passwords, delete empty accounts, configure customer indent ranges, set and update prices, place orders for customers, complete deliveries, inspect balances and history, record/reverse payments, and view order/employee metrics.
- Customer: register, sign in, order by litres or fuel amount with optional extra cash, inspect order details, prices, payment history, indent range, and balance.
- Employee: sign in, search orders, complete deliveries with actual litres delivered, inspect prices and personal delivery activity.

New customers need an admin-configured indent range before ordering. Delivery captures the effective fuel price and charges fuel cost plus extra cash. Administratively recorded payments reduce debt; reversing a payment restores it. Views provide refresh controls rather than automatic cross-device subscriptions.

## Reproduce verification

```bash
npm run verify
```

This uses only the guarded local `petrol_test` database on port 54329, resets its business records, generates Prisma, deploys migrations, checks types/lint/build, and runs 17 API plus 12 desktop/phone browser tests. Close the local development server before running verification because both commands use `.next` build output.

Google Chrome at `/usr/bin/google-chrome` is detected automatically. Set `CHROME_PATH` to an installed compatible browser, or install Playwright Chromium with `npx playwright install chromium`.

Generated results appear in `test-results/` and `playwright-report/` when the suite completes. To stop and remove the disposable service data:

```bash
npm run test:stack:down
```

## Stack and scope

Next.js 16, React 19, Prisma 5, PostgreSQL, Supabase Auth, Tailwind, Radix UI, Playwright, and Axe. [Architecture](ARCHITECTURE.md) describes the current web workflow.

Hosted Supabase, deployment, email delivery, physical phones, Safari, and Firefox have not been verified. Online payment collection, invoice/PDF/tax/discount workflows, offline/PWA use, and separate cash-advance reconciliation are not implemented in the current web flow. The old general Prisma seed is not the tested local setup.
