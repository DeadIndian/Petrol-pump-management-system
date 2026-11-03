# Disposable local test accounts

These accounts are created by `npm run dev:local` and `npm run verify` in the isolated local Supabase Auth/PostgreSQL stack. They are not staging or production accounts.

All passwords: **`LocalPump123!`**.

| Role | Email |
| --- | --- |
| Admin | `phone-admin@petrol.local` |
| Customer | `phone-customer@petrol.local` |
| Employee | `phone-employee@petrol.local` |

Equivalent `desktop-admin`, `desktop-customer`, `desktop-employee` and `api-*` accounts at `petrol.local` are available. The generated IDs and accounts are in `tests/.state/fixtures.json`.

Open http://localhost:3000/login on the computer. On a phone connected to the same Wi-Fi, open `http://<computer-LAN-IP>:3000/login`. The computer's Wi-Fi IP during this handoff was `192.168.1.7`; it can change.

## Manual workflow

1. Admin: in **Prices**, set petrol to ₹100/L and diesel to ₹90/L. In **Billing**, open the customer and configure an unused indent range if necessary.
2. Customer: place a **New order** for 10 L petrol and ₹200 extra cash. Copy the vehicle number to find it easily.
3. Employee: find that vehicle in **Orders**, open it, and complete delivery with 10 L delivered.
4. Customer: refresh **Orders** and **My account**. This delivery adds ₹1,200 to debt.
5. Admin: open that customer in **Billing** and add a ₹500 payment. Debt decreases by ₹500. Reverse the payment to restore it.

Existing disposable records can affect the starting balance. Compare the change in balance, or create a fresh customer through signup and configure its indent range. `npm run verify` resets local business data; avoid running it during manual testing.

The previous accounts and real email addresses documented here were not verified and have been removed from this guide.
