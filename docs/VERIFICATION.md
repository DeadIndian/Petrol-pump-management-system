# Web verification — 2 November 2026

## Result at handoff

The last completed full run passed **27/29 tests**: **17/17 API**, **5/6 desktop**, and **5/6 phone**. Typecheck, lint, production build, Prisma generation, and all five migrations passed in that run.

Both complete business scenarios passed. The two failures were in the combined expired-session/role/outage test: the desktop outage fixture clicked an already-active tab and did not trigger a request; the phone check exposed server navigation racing a successful browser session refresh and blanking the dashboard.

Both causes were patched: the outage fixture explicitly refreshes orders; tabs now update browser history without server navigation, and the dashboard page redirects invalid sessions instead of rendering nothing. The user interrupted the subsequent verification and requested the running site for manual testing. **A clean 29/29 run of these final patches has not been established.**

Before handoff, a short live Chromium phone-emulation smoke check **passed for all three role logins and dashboards using the LAN hostname `192.168.1.7:3000`**. It also passed customer refresh after an expired session, switching to prices with another expired token, and an injected outage followed by successful order refresh. The local development server now allows the computer's own IPv4 hostnames, fixing blocked browser resources over Wi-Fi. These smoke results confirm the final recovery patches on the running development site; they do not replace the full 29-test production suite.

## Verified capabilities

| Workflow | Admin | Customer | Employee | Evidence |
| --- | --- | --- | --- | --- |
| Sign-in, protected views, sign-out | Yes | Yes | Yes | API; desktop and phone browsers |
| Public signup | Creates accounts | Yes | Admin-created | API; desktop and phone browsers |
| User creation/edit, eligible role change, password update, empty-account deletion | Yes | — | — | API; desktop and phone browsers |
| Configure sequential customer indents | Yes | View range | — | API; desktop and phone browsers |
| Current fuel prices and paginated history | Set/update/read | Read | Read | API; desktop and phone browsers |
| Place fuel order by litres or amount, with optional extra cash | For a customer | Own orders | — | API; desktop and phone browsers |
| Order list, search, filters, pagination, details | All orders | Own orders | Delivery orders | API; desktop and phone browsers |
| Complete delivery with actual litres and actor | Yes | — | Yes | API; desktop and phone browsers |
| Customer balance, order/payment history | All customers | Own account | Own activity | API; desktop and phone browsers |
| Record/reverse customer payments | Yes | View own | — | API; desktop and phone browsers |
| Real order, payment, and employee metrics | Yes | — | Own activity | API; desktop and phone browsers |
| Expired-session and outage recovery | Shared logic | Yes | Shared logic | API refresh and final customer phone/LAN smoke passed; full browser suite needs final rerun |

All payment methods were exercised through the API: cash, UPI, cheque, bank transfer, and other. The browser business scenario used UPI. Payments are records entered by an admin; there is no payment gateway.

## Business and concurrency evidence

The scenario used petrol at ₹100/L: 10 L plus ₹200 extra cash produced **₹1,200 debt**. A ₹500 payment reduced it to **₹700**; reversing the payment restored **₹1,200**. The complete three-order scenario ended at **₹2,300 debt** on both desktop and phone emulation.

API checks verified 12 concurrent order allocations produce unique sequential indents; 12 completion attempts charge a delivery once; concurrent range configuration/allocation stays sequential; and concurrent payments/reversals preserve balances and audit records. Further checks covered insufficient permissions, ownership, invalid payloads, exhausted/reused ranges, future price exclusion, delivery-time price capture, prepayment credit, pagination, complete-day filters, real analytics, and HTTP 410 for removed legacy workflows.

## Phone and accessibility evidence

The phone project uses real touch taps in Chromium with Pixel 7 emulation at 390×844. Desktop uses 1440×1000. Additional layout checks covered 320×740, 844×390 landscape, and 768×1024 tablet. The checked surfaces had no horizontal page overflow, dialogs stayed within the viewport, and checked controls met a 44px minimum target.

Both final accessibility sweeps in the last completed run passed with **zero Axe violations** across their checked login/signup, role dashboards, customer details, and dialogs using WCAG 2/2.1/2.2 A/AA tags. Automated checks are not a substitute for a full manual accessibility assessment.

## Reproduce or try manually

```bash
npm ci
npm run dev:local
```

Open `http://localhost:3000/login`, or `http://<computer-LAN-IP>:3000/login` from a phone on the same Wi-Fi. Local credentials and a manual business scenario are in [TEST_CREDENTIALS.md](../TEST_CREDENTIALS.md).

For the full automated check, stop the development website and run `npm run verify`. It resets only the guarded local test database. Completed test reports are generated in `test-results/results.json` and `playwright-report/`; screenshots are written under `test-results/screenshots/{desktop,phone}/`. Interrupted runs may not have a complete report. `npm run test:stack:down` stops and removes the disposable service data.

## Limits

- Physical phones, Safari/WebKit, Firefox, hosted Supabase, deployed infrastructure, and email delivery were not verified. Flutter/Android were excluded.
- No online payment gateway, invoice/PDF/tax/discount flow, offline/PWA mode, automatic browser realtime subscriptions, or separate cash reconciliation exists in the verified web flow.
- Monetary columns remain Float; broader accounting precision and production security/readiness were not established.
- The earlier full dependency audit had 17 remaining findings (16 moderate, 1 low). Compatible updates removed high/critical findings. The final production-only audit was interrupted and is not claimed complete.
- The legacy `prisma/seed.ts` is not the setup used for these verified local accounts.
