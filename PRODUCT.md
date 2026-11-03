# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Administrators manage the petrol pump, customers place fuel orders, and employees complete deliveries. The user confirmed browser access for all three roles, including from phones.

## Product Purpose

Manage fuel orders, daily petrol and diesel prices, sequential customer indent numbers, completed deliveries, customer balances, and recorded payments.

## Operating Context

The web interface must support the complete workflow on desktop and phone browsers. The existing Flutter and Android application is outside the current verification scope.

## Capabilities and Constraints

- Preserve the existing Next.js, React, Prisma, PostgreSQL, and Supabase Auth stack.
- Preserve the existing visual language while making controls, forms, tables, and navigation usable with touch and small screens.
- Fuel cost plus the order's extra cash is charged to the customer when delivery completes. Payments reduce the customer's debt.
- An administrator configures each customer's indent range before ordering.
- End-to-end verification uses disposable local PostgreSQL and real Supabase Auth services, as selected by the user.
- Verification of an existing hosted deployment and physical phones remains a separate, explicitly unverified context.

## Evidence on Hand

The repository contains the API and admin interface. Automated browser and API checks will record verified behavior; sample data must not be presented as operational analytics.
