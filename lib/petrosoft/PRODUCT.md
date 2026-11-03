# Petrosoft replica

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users and operating context

Petrol pump administrators and staff record daily fuel and lubricant business, customer credit and recovery, purchases, banking, employee cash collections, payroll, stock, loyalty activity, and accounting reports. The software runs on desktop and phone browsers. The local station preserves a private authorized import.

## Source contract

The user requested a one-to-one replica of the application accessible at `https://petrosoft.ymtsindia.in`, then asked to finish quickly and preserve progress using Git branches and GitHub. The existing source templates, navigation, terminology, palette, layouts, icons, fonts, form fields, and table structures are the visual authority. This is source reproduction in Operate mode. Preserve its interface, including legacy dense layouts and its existing branded gradients. The original station is inspected read-only; business writes go only to the replica.

## Implementation boundaries

The replica covers 85 captured screens and 91 report definitions through local same-origin controllers, a Next.js server, PostgreSQL, and persistent upload storage. Role and station boundaries apply to reads, business mutations, exports, and service actions. The older delivery application at `/dashboard` retains its own setup and authentication.

SMS, email, WhatsApp, biometric device access, government document issuance, and live BPCL access require configurable service bridges. Their flows were tested with a local mock; no real messages or government documents were issued. Original company-logo files that return 404 use an avatar fallback.

## Evidence and limits

Private original page and report captures live outside Git. Browser evidence is under `.impeccable/review`; isolated database tests exercise business workflows. Selected balances, employee rows, attendance, and DSR cells were reconciled against source responses. Complete exact financial valuation, dealer margin, and spreadsheet parity remains unverified, as do unavailable original modules and provider internals. The delivered documentation must distinguish working local behavior from those limits.
