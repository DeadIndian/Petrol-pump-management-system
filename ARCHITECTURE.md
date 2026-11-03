# Current web architecture

## Petrosoft station management

`/petrosoft` serves the captured source layouts with local JavaScript controllers. Its HTTP endpoints under `/api/petrosoft` authenticate a station-scoped session and enforce role permissions independently of the screen. The application uses its own PostgreSQL connection and password/session records; it does not require Supabase Auth.

Prisma stores stations, users, sessions, sequences, business entries, ledger postings, attachments, audit events, and retained source archives. Entries and ledger amounts use PostgreSQL Decimal columns. Business dates use Asia/Kolkata. Source snapshots and operational records are separate, so collecting a fresh source archive does not overwrite local transactions.

The action service validates products, customers, employees, vendors, tanks, and payment accounts. Serializable transactions save each business entry with its related ledger postings and audit record; retries handle transaction conflicts. Fuel receipts post quantity to the selected tank. Meter sales reduce tank stock and assign collections to employees. Credit sales move the appropriate share of employee collections to customer receivables. Recoveries, expenses, employee collections, and bank handovers update the corresponding accounts. Edits replace prior postings and adjust affected dated snapshots; reversals undo linked movements.

Generated invoices retain the source sales and protect them from further edits. Generating an invoice does not charge the customer again. Local statements, reports, and HTML/CSV/XLSX/PDF exports read these records. Messaging, biometric hardware, BPCL, and government document issuance need separately configured provider bridges.

`npm run test:petrosoft` exercises database transactions in isolated test stations. With a local server running, `npm run test:petrosoft:browser` signs into an isolated station and uses the actual screens to save rates, receipts, sales, recoveries, expenses, employee collections, settlement, and billing. It verifies persisted closing balances, rate and receipt edits, legacy receipt allocations, invoice freezing, and PDF output. See [Petrosoft setup and verification](docs/PETROSOFT.md) for details and fidelity limits.

## Earlier delivery application

The remaining sections describe `/dashboard`. They supersede older claims about realtime subscriptions, separate bill creation, tax/discount calculations, cash reconciliation, RLS verification, and production deployment for that application. See [delivery verification evidence](docs/VERIFICATION.md) for what was actually exercised.

## Request and authentication flow

Next.js serves public `/login` and `/signup` pages and role-specific `/dashboard` views. Customer details under `/dashboard/customers/[id]` are admin-only. Supabase Auth manages passwords and sessions; Prisma's user record determines the application role. Browser sessions use HTTP-only access and refresh cookies. APIs also accept Bearer tokens.

Server pages enforce authentication. Browser API calls share a session-refresh request when access expires. Dashboard tabs update browser history without a server navigation, allowing data requests to recover the session. Invalid refresh tokens return users to sign-in. APIs independently check roles and resource ownership.

## Stored records

The delivery application uses six Prisma tables: users, customer_profiles, orders, fuel_prices, payments, and audit_logs. Customer profiles track balances, aggregate purchases/payments, and configured indent ranges. Orders store the customer, vehicle, indent, requested fuel amount or litres, extra cash, actual delivery quantity, captured price, delivery actor, and timestamps.

## Orders and billing

Customers place their own orders; admins can place an order for a customer. Customer profile row locks and a unique customer/indent constraint protect sequential allocation. Admin indent reconfiguration uses the same lock and rejects ranges that reuse existing order indents.

Employees and admins complete deliveries. The transaction captures the latest price effective on the business date, records actual litres and the actor, and charges `(litres × captured price) + extra cash` once. Pending orders do not charge the balance. The current browser flow goes from pending to completed; the schema retains a legacy delivered state.

A negative stored balance means debt; a positive balance means credit. Admin-recorded payments add credit to the balance, and reversals undo it under transaction locks with audit records. Monetary database fields remain Float. The demonstrated calculations do not establish comprehensive financial precision for every possible value.

## Prices and views

Prices have one record per fuel type per effective day. Admins can set today's price and update that day's record. Future prices do not apply to present deliveries. History is paginated. Business dates use Asia/Kolkata.

Admin views cover overview metrics, orders, prices, customer billing, employee activity, and users. Customers and employees receive role-appropriate orders, prices, and account views. The current views load through HTTP and expose refresh controls; there are no active browser realtime subscriptions.

Legacy separate bill creation/payment and cash-advance routes return HTTP 410. Analytics and billing endpoints use the current order/payment model.

## Verification environment

`compose.e2e.yaml` runs an isolated PostgreSQL database, Supabase GoTrue Auth, and an Auth gateway. Local-only environment keys are generated by `tests/support/environment.ts`. Fixture seeding refuses to reset any database except `127.0.0.1:54329/petrol_test`.

`npm run verify` checks migrations, types, lint, a production build, and API/desktop/phone browser workflows. `npm run dev:local` starts the same isolated services with the development website on port 3000. Hosted infrastructure, physical phones, email delivery, deployment security, and the Flutter app remain unverified.
