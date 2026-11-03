# Petrosoft replica

Petrosoft runs independently against PostgreSQL. The captured station's original page templates, navigation, styles, icons, and fonts are served locally; the original site's scripts and form destinations have been replaced with local controllers. Business operations update the local database. The root URL opens `/petrosoft`; the existing delivery application remains at `/dashboard` and retains its own authentication and setup.

## Start an installation

Requires Node.js 20.9 or newer, npm, Docker Compose, and PostgreSQL 16. Google Chrome or Chromium is also required for PDF exports.

```bash
npm ci
npm run petrosoft:setup
npm run dev:petrosoft
```

Setup starts `compose.petrosoft.yaml`, applies Prisma migrations, and asks for a local administrator password. It preserves an existing station when rerun. Open http://localhost:3000/petrosoft, enter the station code, then sign in as `admin` with the password entered during setup. The current workspace's station code is already initialized; setup will retain its imported data and account.

For an empty station with your own code and name:

```bash
npm run petrosoft:setup -- --empty --code MY-STATION --name "My Filling Station" --user admin
```

An empty installation supports the same workflows. Add fuel products, employees, customers, vendors, bank parties, tanks, nozzles, pump assignments, and opening balances before recording business transactions. The organization and settings pages configure the station, purchase policy, bill numbering, and printing.

The database is bound to `127.0.0.1:54330`. Its Docker volume persists independently of the development server. `.env.petrosoft.local` holds `PETROSOFT_DATABASE_URL` and optional provider configuration. Keep that file private. `npm run dev:petrosoft` loads it automatically and listens on all interfaces, so a phone on the same network can open `http://<computer-IP>:3000/petrosoft`.

To reset an existing local administrator password, run `npm run petrosoft:setup -- --reset-password`. Supply `--code` and `--user` when the installation uses custom values. This expires that user's local sessions.

## Private data and storage

The GitHub branch contains application code and sanitized templates. It excludes station records, passwords, sessions, uploaded files, database backups, and screenshots containing station data. The current local database includes the private import; a fresh clone starts empty unless that import is supplied separately.

For an authorized Petrosoft SQL backup, parse it as data before importing:

```bash
python scripts/petrosoft/native.py /absolute/path/to/private-backup.sql
npm run petrosoft:setup -- --native .petrosoft/native.json
```

The parser reads SQL inserts and writes `.petrosoft/native.json`; it does not execute the backup's SQL. Setup imports into the local station, recreates balances and relationships, preserves supplementary native records and original audit history, and hashes the chosen local administrator password. For an already initialized station, use `--add-data` deliberately when adding a private import. Setup's maintenance flags for repairing or rebooking imported records are intended for data migration work, because they can recalculate imported postings.

Uploads are stored under `.petrosoft/uploads`, or under `<PETROSOFT_STORAGE>/uploads` when configured. They are served through authenticated, station-scoped endpoints. Back up PostgreSQL and that upload directory together. The application's JSON backup controls provide a portable station snapshot; uploaded binary files must also be retained.

Docker's `petrosoft-data` volume retains local database progress. Keep the volume when stopping the stack:

```bash
docker compose -f compose.petrosoft.yaml stop
```

## Production startup

```bash
npm run build
npm run start:petrosoft
```

Use a persistent PostgreSQL database and a persistent upload directory. Put your runtime configuration in `.env.petrosoft.local` for `start:petrosoft`, or start Next with equivalent environment variables supplied by your host. Put HTTPS in front of the server. To use another Chrome executable for PDF generation and browser verification, set `PETROSOFT_CHROME` to its absolute path; the default is `/usr/bin/google-chrome`.

The replica needs a Node.js server, PostgreSQL, and writable persistent storage. It is not a static HTML export. The earlier delivery application additionally requires its existing Supabase configuration.

## External service connections

The communication, biometric, E-Invoice, E-way Bill, and live BPCL controls call a configurable HTTP bridge. Each provider exposes the following variables:

| Service | Endpoint | Credential |
| --- | --- | --- |
| SMS | `PETROSOFT_SMS_URL` | `PETROSOFT_SMS_KEY` |
| Email | `PETROSOFT_EMAIL_URL` | `PETROSOFT_EMAIL_KEY` |
| WhatsApp | `PETROSOFT_WHATSAPP_URL` | `PETROSOFT_WHATSAPP_KEY` |
| Biometric device | `PETROSOFT_BIOMETRIC_URL` | `PETROSOFT_BIOMETRIC_KEY` |
| E-Invoice | `PETROSOFT_EINVOICE_URL` | `PETROSOFT_EINVOICE_KEY` |
| E-way Bill | `PETROSOFT_EWAY_URL` | `PETROSOFT_EWAY_KEY` |
| BPCL fleet | `PETROSOFT_BPCL_URL` | `PETROSOFT_BPCL_KEY` |

Restart the server after configuring a connection. Credentials remain server-side. A bridge translates this installation's requests to your provider or device protocol; the original site's private provider configuration is not part of the replica.

Bridge requests are JSON POSTs with a 20-second timeout:

```json
{
  "version": 1,
  "service": "einvoice",
  "operation": "generate",
  "station": { "code": "MY-STATION", "name": "My Filling Station" },
  "payload": {}
}
```

The bridge receives `Authorization: Bearer <KEY>` when a key is configured. Document operations also send `Idempotency-Key`; the bridge must honor it to avoid issuing duplicate documents on retries. Communication payloads contain `to`, `message`, and `subject`. Biometric `employees` requests contain the local active employee list. BPCL `transactions` requests contain the report date range and filters, and must return `{ "rows": [...] }`.

Government document operations are `generate`, `cancel`, and `status`. A successful generate response must include `reference`, `irn`/`Irn`, or `ewayBillNo`. E-Invoice acknowledgment fields `AckNo`/`AckDt` are retained. Status responses use `draft`, `pending`, `generated`, `cancelled`, `failed`, or `unknown`. Cancellation sends a reason; E-way generation sends vehicle, distance, and transporter fields. HTTP failures and `{ "ok": false }` or `{ "error": "..." }` responses show an error locally. Ambiguous generation failures retain an `unknown` state; check provider status before changing the invoice. An active or unresolved government document protects the local invoice from deletion or editing until cancellation is confirmed.

No real messages or government documents were issued during development or verification. Those paths were exercised against a local mock service. Unconfigured connections show a setup message and prevent sending; local invoices, statements, reports, and stored fleet records remain usable.

## Verification and fidelity

```bash
npm run test:petrosoft
npm run petrosoft:check-privacy
npm run lint
npm run typecheck
npm run build
```

The Petrosoft tests create isolated `TEST-PETROSOFT-*` stations, exercise real database transactions, and remove only those test stations. They cover sales and reversals, backdated cash and stock, linked vendor/bank purchases, concurrency and uniqueness, invoice freezing, payroll and loans, roles and station boundaries, loyalty redemptions, master child replacements, file access, atomic CSV import, mocked external services, historical FIFO consumption, Tally projections, dashboard filters, stock locations, all 91 report definitions, and HTML/CSV/XLSX/PDF exports.

For browser checks, create an authenticated local Playwright storage state at a private path, then run:

```bash
node scripts/petrosoft/check-ui.mjs --session /absolute/path/to/private-session.json
```

This checks every captured module at 1600×1080 and 390×844, including selected auxiliary forms and report/service dialogs. It records readiness, JavaScript errors, failed requests, broken images, and document overflow, and blocks external browser requests. Private evidence is written to `.impeccable/review`. Optional `--base`, `--modules`, and `--out` arguments select a server, module IDs, and evidence directory. The checks do not submit business forms.

Where the private original report captures are available, `npx tsx scripts/petrosoft/check-reports.ts` renders the local report matrix into `.petrosoft/report-checks` without changing the station. The original account was inspected read-only. Captured source failures in reports 23, 35, 39, 43, and 56 are replaced with working local reports.

This is a working replica of the 85 accessible screens and 91 captured report definitions. Selected customer balances, employee accounting, attendance, and DSR cells were reconciled against original responses. Exact parity for every financial valuation, dealer margin/profit convention, Tally invoice numbering, and spreadsheet constant has not been established. Source company-logo files that return 404 use a local avatar fallback. Provider delivery, actual biometric hardware, NIC/GSP issuance, and BPCL live access depend on your configured bridges. The original application's server source and unavailable modules were not accessible, so the implementation does not claim verified one-to-one parity for those internals.

## Verification record: 3 November 2026

- All 18 Petrosoft database and export tests passed. Service tests used a local HTTP mock.
- The privacy check passed for all 102 shipped HTML templates and fragments; captured credential fields, including nameless hidden inputs, are empty.
- Lint, TypeScript checking, and the Next.js 16.4.3 production build passed. Production starts with `npm run start:petrosoft` without requiring the older delivery application's Supabase settings.
- The browser matrix covered 85 modules at desktop (1600×1080) and phone (390×844) sizes, with 184 captures including 12 actual auxiliary dialogs. It found no JavaScript errors, failed requests, external requests, broken images, or document horizontal overflow.
- Two E-way provider-dialog captures were skipped because the selected date range contained no eligible invoices. The empty listings and mock-tested backend do not establish live provider delivery.
- The Statements capture was repeated with explicit document bounds because clipped native dropdowns inflated Chrome's automatic full-page canvas. The corrected evidence retains the full visible page without changing its layout.
- A private PostgreSQL archive was saved under `.petrosoft/backups` and checked with `pg_restore --list`; its SHA-256 manifest is stored beside it. Imported records, archives, uploads, browser sessions, and screenshots remain outside Git.
