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

The database is bound to `127.0.0.1:54330`. Its Docker volume persists independently of the development server. `.env.petrosoft.local` holds `PETROSOFT_DATABASE_URL` and optional provider configuration. Keep that file private. The Petrosoft development, build, and start commands load it automatically. `npm run dev:petrosoft` listens on all interfaces, so a phone on the same network can open `http://<computer-IP>:3000/petrosoft`.

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

## Read-only source collection

The collector downloads the original station's full SQL export, parses it as data, and saves table contents from the accessible screens, history filters, and report exports. It also requests individual customer and employee statements. Named credential fields and ephemeral session tables are excluded from parsed data. Source page scripts are never executed. The original station's business forms, messaging controls, and document issuance actions are not submitted.

Install the optional Python tools in private local storage, then capture a fresh snapshot:

```bash
python3 -m venv .petrosoft/source-tools
source .petrosoft/source-tools/bin/activate
python -m pip install -r scripts/petrosoft/requirements.txt
npm run petrosoft:fetch-source -- --login --out .petrosoft/source/snapshot-1
npm run petrosoft:store-source -- --snapshot .petrosoft/source/snapshot-1
```

The login prompt uses the original website's password. The station code defaults to the local setup; supply `--code` and `--user` for a different authorized installation. Passwords are not accepted as command-line arguments. Sessions are retained privately and bound to the selected station. Choose a new output folder for each fresh export; repeating a collection with the same folder resumes it. `--backup-only` collects the full database export without the additional views. `--reports-only` resumes report collection, and `--refresh-reports` requests updated report variants.

For a snapshot with timed-out reports, use `--retry-timeouts --out .petrosoft/source/snapshot-1` with its original `--from` and `--to` dates. This requests only those date-range reports in monthly sections, preserves the original failure entries, and records the successful sections under `recoveredBy`. Customer statements include source credit, payment, and opening dates; the month-wise credit report starts at its earliest source credit date. Both the requested and retried ranges are recorded. Already saved sections, including source warning responses, are not requested again. Sections with source errors remain partial and are not marked as recovered.

Snapshots, source exports, authenticated sessions, and logs stay inside ignored `.petrosoft` storage. The database stores sanitized native tables, extracted view/report tables, binary report exports, and their manifests under `petrosoft_native_records` with `table_name = 'source-archive'`. Copies are identified by their content hashes, so repeating storage skips existing copies and retains changed versions. The destination station must match the source manifest. The local application's JSON backups include these source copies.

This storage step preserves source material for inspection and migration; operational entries and ledger postings keep their existing values. The current installation already contains the normalized business import. New source copies do not automatically rebook transactions or overwrite local edits. Source reports can fail, time out, or emit PHP warnings; manifests record those outcomes, and saved report data can be partial. A scraper cannot reconstruct history absent from the original export and accessible views.

To inspect a retained native table for your station:

```sql
SELECT fields->'data'->'rows'
FROM petrosoft_native_records
WHERE workspace_id = (
  SELECT id FROM petrosoft_workspaces WHERE reference_code = 'MY-STATION'
)
AND table_name = 'source-archive'
AND fields->>'kind' = 'native-table'
AND fields->>'key' = 'k_cust';
```

Collector checks are available with `npm run test:petrosoft:source-requests`; the Petrosoft test suite also checks archive replay, credential removal, preservation of live balances, and station boundaries.

## Production startup

```bash
PETROSOFT_NEXT_DIST_DIR=.petrosoft/builds/production npm run build:petrosoft
PETROSOFT_NEXT_DIST_DIR=.petrosoft/builds/production npm run start:petrosoft
```

Use the same `PETROSOFT_NEXT_DIST_DIR` for building and starting. Keep the selected directory in `.env.petrosoft.local` for subsequent starts. When replacing a running version, build into a new directory, verify it on another port, then switch the main server to that directory. Next owns its build directory and can replace its contents.

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
npm run build:petrosoft
```

The Petrosoft tests create isolated `TEST-PETROSOFT-*` stations, exercise real database transactions, and remove only those test stations. They cover sales and reversals, backdated cash and stock, linked vendor/bank purchases, concurrency and uniqueness, invoice freezing, payroll and loans, roles and station boundaries, loyalty redemptions, master child replacements, file access, atomic CSV import, mocked external services, historical FIFO consumption, Tally projections, dashboard filters, stock locations, all 91 report definitions, and HTML/CSV/XLSX/PDF exports.

With a local Petrosoft server running against the same database, verify the operator workflows:

```bash
npm run test:petrosoft:browser
```

Set `PETROSOFT_TEST_BASE_URL` to test another port. These tests sign in through the actual screens, save a complete day, reload records, edit rates, fuel receipts, and fuel/lubricant sales, and generate an invoice with PDF output. They verify stock and customer, employee, bank, and cash balances in PostgreSQL, protect billed sales, and preserve imported receipts without tank allocations. Additional browser workflows exercise employee creation, adding expense types, GST purchases and bank payments, POS collections, mixed cash/credit lubricant rows, bowser/nozzle configuration, bowser receipts and readings, and bowser cash/credit lubricant sales. Source add-row buttons are connected, and repeated radio groups retain each row's sale type independently. Screenshots and balance evidence stay in `.petrosoft/workflow-checks`.

### Bowser stock and sales

Use **Add Bowser** to configure its fuel product, capacity, and initial stock. Select it and use **Nozzles** to add its meters with initial readings. The **Bunk Nozzles** receipt dialog selects local station nozzles; the **Bowser Nozzles** dialog records closing readings, testing, rates, and sale amounts.

The local accounting convention treats loading as part of the station's recorded meter quantity. Save the station meter entry before its bowser receipt. A receipt can use only that nozzle's unallocated metered quantity for the day. Loading reclassifies its value out of station cash, revenue, and the station operator's responsibility; bowser dispensing records the driver's sales. The tank's original meter withdrawal remains unchanged, while remaining bowser fuel stays in company product inventory. This prevents counting the transfer as a second tank withdrawal or customer sale. For example, a 100-litre station meter including a 50-litre bowser load, followed by 40 litres sold from the bowser, leaves 10 litres in the bowser and records 90 litres of customer sales overall.

Each bowser has one daily record. Opening stock and nozzle readings carry forward. Reverse later bowser days before changing an earlier one; a referenced station meter is protected until its bowser receipt is reversed. Testing reduces bowser closing stock when source feature 52 is enabled. These rules are database-tested local behavior; the source account had no configured bowser history available to establish its financial conventions.

For the full screen matrix, create an authenticated local Playwright storage state at a private path, then run:

```bash
node scripts/petrosoft/check-ui.mjs --session /absolute/path/to/private-session.json
```

This checks every captured module at 1600×1080 and 390×844, including selected auxiliary forms and report/service dialogs. It records readiness, JavaScript errors, failed requests, broken images, and document overflow, and blocks external browser requests. Private evidence is written to `.impeccable/review`. Optional `--base`, `--modules`, and `--out` arguments select a server, module IDs, and evidence directory. This matrix checks loading and layout; the operator tests above submit business forms.

Where the private original report captures are available, `npx tsx scripts/petrosoft/check-reports.ts` renders the local report matrix into `.petrosoft/report-checks` without changing the station. The original account was inspected read-only. Captured source failures in reports 23, 35, 39, 43, and 56 are replaced with working local reports.

This is a working replica of the 85 accessible screens and 91 captured report definitions. Selected customer balances, employee accounting, attendance, and DSR cells were reconciled against original responses. Exact parity for every financial valuation, dealer margin/profit convention, Tally invoice numbering, and spreadsheet constant has not been established. Source company-logo files that return 404 use a local avatar fallback. Provider delivery, actual biometric hardware, NIC/GSP issuance, and BPCL live access depend on your configured bridges. The original application's server source and unavailable modules were not accessible, so the implementation does not claim verified one-to-one parity for those internals.

## Verification record: 3 November 2026

- All 26 Petrosoft database and export tests passed. Service tests used a local HTTP mock. This includes purchase invoice aliases, rate-date uniqueness, cash/credit lubricant validation, bowser transfers, stock carryover, reversals, and billing without duplicate ledger postings.
- Three real browser workflows verified a complete business day, employee and expense-type creation, GST purchases and payment edits, sales edits, POS collections, and bowser operations. The business-day closing balances were tank stock 900 litres, customer due ₹500, employee due ₹0, bank ₹9,000, and cash ₹300. Evidence stays in `.petrosoft/workflow-checks`.
- All three operator workflows passed together against the final production build, including mixed cash/credit lubricant rows and bowser cash/credit sales. That build now runs on port 3000; its private build-directory setting is retained for subsequent starts. The authenticated dashboard and an API read of imported meter entries dated 31 October 2026 both returned HTTP 200, without browser errors or external requests.
- The final production screen matrix repeated all 85 modules at desktop and phone sizes: 184 captures, zero issues, with two provider dialogs skipped for lack of eligible invoices. All 91 reports also rendered against the imported station with no failures; some source filters selected empty periods. These checks establish loading and the tested workflows, rather than reconciliation of every report value with the original software.
- A fresh private PostgreSQL backup was saved on 3 November 2026 at 17:43 UTC, with a SHA-256 manifest and a successful `pg_restore --list` check. No temporary `TEST-PETROSOFT-*` stations remained after verification. Temporary verification sessions and candidate servers were removed; the main production server and database remain running.
- The privacy check passed for all 102 shipped HTML templates and fragments; captured credential fields, including nameless hidden inputs, are empty.
- Lint, TypeScript checking, and the Next.js 16.4.3 production build passed. Production starts with `npm run start:petrosoft` without requiring the older delivery application's Supabase settings.
- The final production smoke check passed: `/` redirects to `/petrosoft`, the authenticated dashboard iframe loads without browser errors or external requests, and `/dashboard` retains its own login redirect.
- The browser matrix covered 85 modules at desktop (1600×1080) and phone (390×844) sizes, with 184 captures including 12 actual auxiliary dialogs. It found no JavaScript errors, failed requests, external requests, broken images, or document horizontal overflow.
- The finish reviewer scored all six listed corrections resolved: native table controls, original action/status assets, phone meter summaries, report-dialog keyboard focus, selected-tank labels, and vehicle-dialog footer spacing. Its `ship` disposition applies to those six findings. The verdict follow-up exceeded the review service's payload limit and was replaced by a fresh review of the same six findings; this does not establish whole-software one-to-one parity.
- Two E-way provider-dialog captures were skipped because the selected date range contained no eligible invoices. The empty listings and mock-tested backend do not establish live provider delivery.
- The Statements capture was repeated with explicit document bounds because clipped native dropdowns inflated Chrome's automatic full-page canvas. The corrected evidence retains the full visible page without changing its layout.
- A private PostgreSQL archive was saved under `.petrosoft/backups` and checked with `pg_restore --list`; its SHA-256 manifest is stored beside it. Imported records, archives, uploads, browser sessions, and screenshots remain outside Git.

The source visual system and responsive conventions are recorded in [Petrosoft DESIGN.md](../lib/petrosoft/DESIGN.md), with standalone component specimens in the [design sidecar](../lib/petrosoft/.impeccable/design.json). These documents are scoped to the Petrosoft application.
