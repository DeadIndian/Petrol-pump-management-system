import { test, expect, type APIRequestContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { password, readFixtures, type Scope, type FixtureUser } from "../support/fixtures";
import { businessDate } from "../../lib/dates";
let scope: Scope;
const prisma = new PrismaClient();
let deliveredCustomer: FixtureUser;
let deliveredOrderId: string;
async function headers(request: APIRequestContext, user: FixtureUser) {
  const response = await request.post("/api/auth/login", { data: { email: user.email, password } });
  expect(response.status()).toBe(200);
  return { Authorization: `Bearer ${(await response.json()).session.accessToken}` };
}
async function newCustomer(request: APIRequestContext, adminHeaders: Record<string, string>, name: string) {
  const response = await request.post("/api/admin/users", { headers: adminHeaders, data: {
    email: `${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}@petrol.local`, password, fullName: name, role: "CUSTOMER",
  } }); expect(response.status()).toBe(201); return (await response.json()).user as FixtureUser;
}
async function indent(request: APIRequestContext, adminHeaders: Record<string, string>, user: FixtureUser, start: number, end: number) {
  const response = await request.post(`/api/admin/users/${user.id}/indent`, { headers: adminHeaders, data: { indentStart: start, indentEnd: end } });
  expect(response.status()).toBe(200);
}
test.beforeAll(() => { scope = readFixtures().api; });
test.afterAll(async () => { await prisma.$disconnect(); });

test("protected endpoints reject missing and forged authentication", async ({ request }) => {
  for (const path of ["/api/orders", "/api/prices", "/api/customers", "/api/admin/users", "/api/account"]) {
    expect((await request.get(path)).status()).toBe(401);
    expect((await request.get(path, { headers: { Authorization: "Bearer forged" } })).status()).toBe(401);
  }
  const response = await request.get("/dashboard", { headers: { Cookie: "auth_token=forged" }, maxRedirects: 0 });
  expect(response.status()).toBe(307); expect(response.headers().location).toContain("/login");
});

test("customer signup creates a profile and rejects public staff registration", async ({ request }) => {
  const email = `signup-${Date.now()}@petrol.local`;
  expect((await request.post("/api/auth/signup", { data: { email, password, fullName: "Signup Customer", role: "EMPLOYEE" } })).status()).toBe(400);
  const response = await request.post("/api/auth/signup", { data: { email, password, fullName: "Signup Customer" } });
  expect(response.status()).toBe(201);
  const user = (await response.json()).user;
  const auth = await headers(request, user);
  const account = await (await request.get("/api/account", { headers: auth })).json();
  expect(account.user.customerProfile.currentBalance).toBe(0);
  expect(account.user.customerProfile.currentIndent).toBeNull();
  expect((await request.get("/api/admin/users", { headers: auth })).status()).toBe(403);
});

test("daily prices can be set, read, updated and cannot be duplicated or backdated", async ({ request }) => {
  const admin = await headers(request, scope.admin);
  const customer = await headers(request, scope.customer);
  for (const [fuelType, pricePerLiter] of [["PETROL", 100], ["DIESEL", 90]] as const) {
    const created = await request.post("/api/admin/prices", { headers: admin, data: { fuelType, pricePerLiter } }); expect(created.status()).toBe(201);
    const price = (await created.json()).price;
    expect((await request.put("/api/admin/prices", { headers: admin, data: { priceId: price.id, newPricePerLiter: pricePerLiter + 1 } })).status()).toBe(200);
    expect((await request.put("/api/admin/prices", { headers: admin, data: { priceId: price.id, newPricePerLiter: pricePerLiter } })).status()).toBe(200);
    expect((await request.post("/api/admin/prices", { headers: admin, data: { fuelType, pricePerLiter } })).status()).toBe(400);
  }
  expect((await request.post("/api/admin/prices", { headers: customer, data: { fuelType: "PETROL", pricePerLiter: 1 } })).status()).toBe(403);
  expect((await request.post("/api/admin/prices", { headers: admin, data: { fuelType: "PETROL", pricePerLiter: 99, date: "2000-01-01T00:00:00.000Z" } })).status()).toBe(400);
  const current = await (await request.get("/api/prices", { headers: customer })).json();
  expect(current.prices.find((price: any) => price.fuelType === "PETROL").pricePerLiter).toBe(100);
  expect((await request.get("/api/prices/history?fuelType=PETROL", { headers: customer })).status()).toBe(200);
});

test("admin account creation, editing, role changes, password reset and deletion", async ({ request }) => {
  const admin = await headers(request, scope.admin);
  const user = await newCustomer(request, admin, "Managed Account");
  expect((await request.patch(`/api/admin/users/${user.id}`, { headers: admin, data: { fullName: "Updated Account", phone: "9876543210", role: "EMPLOYEE", password: "ChangedPump123!" } })).status()).toBe(200);
  expect((await request.post("/api/auth/login", { data: { email: user.email, password } })).status()).toBe(401);
  expect((await request.post("/api/auth/login", { data: { email: user.email, password: "ChangedPump123!" } })).status()).toBe(200);
  expect((await request.patch(`/api/admin/users/${user.id}`, { headers: admin, data: { role: "CUSTOMER" } })).status()).toBe(200);
  expect((await request.delete(`/api/admin/users/${scope.admin.id}`, { headers: admin })).status()).toBe(400);
  expect((await request.patch(`/api/admin/users/${scope.admin.id}`, { headers: admin, data: { role: "CUSTOMER" } })).status()).toBe(400);
  expect((await request.delete(`/api/admin/users/${user.id}`, { headers: admin })).status()).toBe(200);
  expect((await request.post("/api/auth/login", { data: { email: user.email, password: "ChangedPump123!" } })).status()).toBe(401);
});

test("orders require configured indents and remain scoped to the customer", async ({ request }) => {
  const admin = await headers(request, scope.admin), customer = await headers(request, scope.customer), employee = await headers(request, scope.employee);
  const payload = { vehicleNumber: "MH12AB1234", fuelType: "PETROL", quantityRequested: 2, cash: 5 };
  expect((await request.post("/api/orders", { headers: customer, data: payload })).status()).toBe(400);
  await indent(request, admin, scope.customer, 1000, 1100);
  const created = await request.post("/api/orders", { headers: customer, data: payload }); expect(created.status()).toBe(201);
  const order = (await created.json()).order;
  expect(order.indentNumber).toBe(1000); expect(order.status).toBe("PENDING");
  expect((await request.post("/api/orders", { headers: customer, data: { ...payload, customerId: scope.other.id } })).status()).toBe(403);
  expect((await request.post("/api/orders", { headers: employee, data: payload })).status()).toBe(403);
  const other = await headers(request, scope.other);
  expect((await request.get(`/api/orders/${order.id}`, { headers: other })).status()).toBe(403);
  expect((await request.patch(`/api/orders/${order.id}`, { headers: customer, data: { quantityDelivered: 2 } })).status()).toBe(403);
  expect((await request.get(`/api/orders?customerId=${scope.customer.id}`, { headers: other })).status()).toBe(403);
});

test("concurrent order requests consume distinct indents and reject exhausted or reused ranges", async ({ request }) => {
  const admin = await headers(request, scope.admin);
  const user = await newCustomer(request, admin, "Indent Race"); await indent(request, admin, user, 2000, 2011);
  const auth = await headers(request, user);
  const responses = await Promise.all(Array.from({ length: 12 }, (_, index) => request.post("/api/orders", { headers: auth, data: { vehicleNumber: `RACE-${index}`, fuelType: "PETROL", quantityRequested: 1 } })));
  expect(responses.map(response => response.status())).toEqual(Array(12).fill(201));
  const orders = await Promise.all(responses.map(async response => (await response.json()).order));
  expect(orders.map(order => order.indentNumber).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, index) => 2000 + index));
  expect((await request.post("/api/orders", { headers: auth, data: { vehicleNumber: "EXHAUSTED", fuelType: "PETROL", quantityRequested: 1 } })).status()).toBe(409);
  expect((await request.post(`/api/admin/users/${user.id}/indent`, { headers: admin, data: { indentStart: 2000, indentEnd: 2011 } })).status()).toBe(409);
});

test("a delivery charges exactly once under twelve concurrent completion attempts", async ({ request }) => {
  const admin = await headers(request, scope.admin), employee = await headers(request, scope.employee);
  deliveredCustomer = await newCustomer(request, admin, "Delivery Race"); await indent(request, admin, deliveredCustomer, 3000, 3010);
  const created = await request.post("/api/orders", { headers: admin, data: { customerId: deliveredCustomer.id, vehicleNumber: "DELIVERY-RACE", fuelType: "PETROL", quantityRequested: 10, cash: 200 } }); expect(created.status()).toBe(201);
  deliveredOrderId = (await created.json()).order.id;
  const responses = await Promise.all(Array.from({ length: 12 }, () => request.patch(`/api/orders/${deliveredOrderId}`, { headers: employee, data: { quantityDelivered: 10 } })));
  expect(responses.filter(response => response.status() === 200)).toHaveLength(1);
  expect(responses.filter(response => response.status() === 409)).toHaveLength(11);
  const profile = await prisma.customerProfile.findUniqueOrThrow({ where: { userId: deliveredCustomer.id } });
  expect(profile.currentBalance).toBe(-1200); expect(profile.totalOrders).toBe(1); expect(profile.totalPurchases).toBe(1200);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: deliveredOrderId } });
  expect(order.status).toBe("COMPLETED"); expect(order.fulfilledById).toBe(scope.employee.id); expect(order.totalAmount).toBe(1200);
  expect((await request.delete(`/api/admin/users/${deliveredCustomer.id}`, { headers: admin })).status()).toBe(409);
});

test("payments reduce debt, enforce ownership, support every method and reverse once", async ({ request }) => {
  const admin = await headers(request, scope.admin), owner = await headers(request, deliveredCustomer), other = await headers(request, scope.other), employee = await headers(request, scope.employee);
  const response = await request.post(`/api/customers/${deliveredCustomer.id}/payments`, { headers: admin, data: { amount: 500, paymentMethod: "UPI", reference: "WEB-TEST-500" } }); expect(response.status()).toBe(200);
  const payment = (await response.json()).payment;
  const profile = await prisma.customerProfile.findUniqueOrThrow({ where: { userId: deliveredCustomer.id } }); expect(profile.currentBalance).toBe(-700);
  expect((await request.get(`/api/bills/${payment.id}`, { headers: owner })).status()).toBe(200);
  expect((await request.get(`/api/bills/${payment.id}`, { headers: other })).status()).toBe(403);
  expect((await request.get(`/api/bills/${payment.id}`, { headers: employee })).status()).toBe(403);
  const history = await (await request.get("/api/bills", { headers: owner })).json(); expect(history.payments.map((item: any) => item.id)).toContain(payment.id);
  expect((await request.get(`/api/bills?customerProfileId=${profile.id}`, { headers: other })).status()).toBe(403);
  expect((await request.delete(`/api/bills/${payment.id}`, { headers: admin })).status()).toBe(200);
  expect((await request.delete(`/api/bills/${payment.id}`, { headers: admin })).status()).toBe(404);
  expect((await prisma.customerProfile.findUniqueOrThrow({ where: { id: profile.id } })).currentBalance).toBe(-1200);
  expect(await prisma.auditLog.count({ where: { recordId: payment.id, action: "PAYMENT_REVERSED" } })).toBe(1);
  for (const method of ["CASH", "UPI", "CHEQUE", "BANK_TRANSFER", "OTHER"]) expect((await request.post("/api/bills", { headers: admin, data: { customerProfileId: profile.id, amount: 10, paymentMethod: method, paymentMethodNote: method === "OTHER" ? "Test voucher" : undefined } })).status()).toBe(201);
  expect((await prisma.customerProfile.findUniqueOrThrow({ where: { id: profile.id } })).currentBalance).toBe(-1150);
});

test("prepayments create credit and amount orders charge the delivered quantity", async ({ request }) => {
  const admin = await headers(request, scope.admin), employee = await headers(request, scope.employee);
  await indent(request, admin, scope.other, 4000, 4010);
  expect((await request.post(`/api/customers/${scope.other.id}/payments`, { headers: admin, data: { amount: 100, paymentMethod: "CASH" } })).status()).toBe(200);
  const created = await request.post("/api/orders", { headers: admin, data: { customerId: scope.other.id, vehicleNumber: "PREPAY", fuelType: "PETROL", amountRequested: 50 } }); expect(created.status()).toBe(201);
  expect((await request.patch(`/api/orders/${(await created.json()).order.id}`, { headers: employee, data: { quantityDelivered: 0.5 } })).status()).toBe(200);
  expect((await prisma.customerProfile.findUniqueOrThrow({ where: { userId: scope.other.id } })).currentBalance).toBe(50);
});

test("invalid order, payment and pagination payloads return useful client errors", async ({ request }) => {
  const admin = await headers(request, scope.admin), customer = await headers(request, scope.customer);
  for (const fields of [{ quantityRequested: 0 }, { quantityRequested: 1, amountRequested: 100 }, { quantityRequested: 1, cash: 1.5 }, { fuelType: "LPG", quantityRequested: 1 }]) {
    expect((await request.post("/api/orders", { headers: customer, data: { vehicleNumber: "INVALID", fuelType: "PETROL", ...fields } })).status()).toBe(400);
  }
  for (const fields of [{ amount: -1 }, { amount: 1, paymentDate: "not-a-date" }]) expect((await request.post(`/api/customers/${scope.customer.id}/payments`, { headers: admin, data: fields })).status()).toBe(400);
  for (const path of ["/api/orders", "/api/customers", "/api/bills", "/api/admin/users", "/api/prices/history"]) expect((await request.get(`${path}?limit=-1`, { headers: admin })).status()).toBe(400);
  expect((await request.post("/api/orders", { headers: { ...customer, "Content-Type": "application/json" }, data: "{" })).status()).toBe(400);
});

test("order search, status filters and pagination include the entire selected day", async ({ request }) => {
  const admin = await headers(request, scope.admin), customer = await headers(request, scope.customer);
  for (let index = 0; index < 21; index++) expect((await request.post("/api/orders", { headers: customer, data: { vehicleNumber: `PAGE-${index}`, fuelType: "DIESEL", quantityRequested: 1 } })).status()).toBe(201);
  const first = await (await request.get("/api/orders?limit=2&offset=0", { headers: customer })).json();
  const second = await (await request.get("/api/orders?limit=2&offset=2", { headers: customer })).json();
  expect(first.pagination.total).toBe(22); expect(first.orders).toHaveLength(2); expect(second.orders).toHaveLength(2);
  expect(first.orders.map((order: any) => order.id).some((id: string) => second.orders.some((order: any) => order.id === id))).toBe(false);
  expect((await (await request.get("/api/orders?search=PAGE-0", { headers: customer })).json()).pagination.total).toBe(1);
  expect((await (await request.get("/api/orders?status=COMPLETED", { headers: customer })).json()).orders).toHaveLength(0);
  const day = businessDate().toISOString().slice(0, 10);
  const filtered = await request.get(`/api/customers/${scope.customer.id}?startDate=${day}&endDate=${day}`, { headers: admin }); expect(filtered.status()).toBe(200);
  expect((await filtered.json()).pagination.total).toBe(22);
});

test("overview and reports change when real orders and payments are recorded", async ({ request }) => {
  const admin = await headers(request, scope.admin), employee = await headers(request, scope.employee);
  const before = await (await request.get("/api/admin/stats", { headers: admin })).json();
  const order = await (await request.post("/api/orders", { headers: admin, data: { customerId: scope.customer.id, vehicleNumber: "ANALYTICS", fuelType: "PETROL", quantityRequested: 1, cash: 50 } })).json();
  expect((await request.patch(`/api/orders/${order.order.id}`, { headers: employee, data: { quantityDelivered: 1 } })).status()).toBe(200);
  const after = await (await request.get("/api/admin/stats", { headers: admin })).json();
  expect(after.stats.totalOrders).toBe(before.stats.totalOrders + 1); expect(after.stats.totalRevenue).toBe(before.stats.totalRevenue + 150);
  expect(after.charts.revenue.reduce((sum: number, row: any) => sum + row.revenue, 0)).toBe(before.charts.revenue.reduce((sum: number, row: any) => sum + row.revenue, 0) + 150);
  const report = await (await request.get("/api/bills/reports/analytics", { headers: admin })).json();
  expect(report.analytics.totalPaymentsCollected).toBe(150);
  expect((await request.get("/api/bills/reports/analytics", { headers: employee })).status()).toBe(403);
});

test("HTTP-only sessions refresh and logout clears browser access", async ({ playwright }) => {
  const context = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3100" });
  try {
    const response = await context.post("/api/auth/login", { data: { email: scope.admin.email, password } }); expect(response.status()).toBe(200);
    const session = (await response.json()).session;
    const state = await context.storageState(); expect(state.cookies.find(cookie => cookie.name === "auth_token")?.httpOnly).toBe(true);
    const redirect = await context.get("/dashboard", { headers: { Cookie: `auth_token=expired; refresh_token=${session.refreshToken}` }, maxRedirects: 0 });
    expect(redirect.status()).toBe(307); expect(redirect.headers().location).toContain("/api/auth/refresh");
    expect((await context.post("/api/auth/refresh", { headers: { Cookie: `auth_token=expired; refresh_token=${session.refreshToken}` } })).status()).toBe(200);
    expect((await context.get("/api/orders")).status()).toBe(200);
    expect((await context.post("/api/auth/logout")).status()).toBe(200);
    expect((await context.get("/api/orders")).status()).toBe(401);
    expect((await context.post("/api/auth/refresh")).status()).toBe(401);
  } finally { await context.dispose(); }
});

test("removed legacy workflows explicitly return Gone", async ({ request }) => {
  expect((await request.post("/api/cash-advances", { data: {} })).status()).toBe(410);
  expect((await request.patch("/api/bills/removed/pay", { data: {} })).status()).toBe(410);
});

test("indent reconfiguration shares the lock used by concurrent order allocation", async ({ request }) => {
  const admin = await headers(request, scope.admin);
  const user = await newCustomer(request, admin, "Reconfigure Race");
  await indent(request, admin, user, 8000, 8100);
  const auth = await headers(request, user);
  const allocations = Array.from({ length: 12 }, (_, index) => request.post("/api/orders", { headers: auth,
    data: { vehicleNumber: `RECONFIGURE-${index}`, fuelType: "PETROL", quantityRequested: 1 } }));
  const resets = Array.from({ length: 12 }, () => request.post(`/api/admin/users/${user.id}/indent`, { headers: admin,
    data: { indentStart: 8000, indentEnd: 8100 } }));
  const [orders, changes] = await Promise.all([Promise.all(allocations), Promise.all(resets)]);
  expect(orders.map(response => response.status())).toEqual(Array(12).fill(201));
  expect(changes.every(response => [200, 409].includes(response.status()))).toBe(true);
  const saved = await prisma.order.findMany({ where: { customerId: user.id }, orderBy: { indentNumber: "asc" } });
  expect(saved.map(order => order.indentNumber)).toEqual(Array.from({ length: 12 }, (_, index) => 8000 + index));
  expect((await prisma.customerProfile.findUniqueOrThrow({ where: { userId: user.id } })).currentIndent).toBe(8012);
});

test("future prices are excluded and delivery captures the price when fuel is delivered", async ({ request }) => {
  const admin = await headers(request, scope.admin), employee = await headers(request, scope.employee);
  const user = await newCustomer(request, admin, "Delivery Price Capture");
  await indent(request, admin, user, 9000, 9010);
  const customer = await headers(request, user);
  const today = businessDate();
  const current = await prisma.fuelPrice.findUniqueOrThrow({ where: { fuelType_date: { fuelType: "PETROL", date: today } } });
  const future = await prisma.fuelPrice.create({ data: { fuelType: "PETROL", pricePerLiter: 999,
    date: new Date(today.getTime() + 86400000), createdByAdminId: scope.admin.id } });
  try {
    for (const auth of [customer, employee]) {
      const response = await request.get("/api/prices", { headers: auth }); expect(response.status()).toBe(200);
      expect((await response.json()).prices.find((row: any) => row.fuelType === "PETROL").pricePerLiter).toBe(100);
      const history = await (await request.get("/api/prices/history?fuelType=PETROL", { headers: auth })).json();
      expect(history.prices.some((row: any) => row.id === future.id)).toBe(false);
    }
    const created = await request.post("/api/orders", { headers: customer, data: { vehicleNumber: "PRICE-CAPTURE", fuelType: "PETROL", quantityRequested: 3 } }); expect(created.status()).toBe(201);
    expect((await request.put("/api/admin/prices", { headers: admin, data: { priceId: current.id, newPricePerLiter: 101 } })).status()).toBe(200);
    const delivered = await request.patch(`/api/orders/${(await created.json()).order.id}`, { headers: employee, data: { quantityDelivered: 3 } }); expect(delivered.status()).toBe(200);
    const order = (await delivered.json()).order;
    expect(order.pricePerLiter).toBe(101); expect(order.totalAmount).toBe(303);
    expect((await prisma.customerProfile.findUniqueOrThrow({ where: { userId: user.id } })).currentBalance).toBe(-303);
    expect((await request.patch(`/api/admin/users/${user.id}`, { headers: admin, data: { role: "EMPLOYEE" } })).status()).toBe(409);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe("CUSTOMER");
  } finally {
    await prisma.fuelPrice.delete({ where: { id: future.id } });
    await request.put("/api/admin/prices", { headers: admin, data: { priceId: current.id, newPricePerLiter: 100 } });
  }
});

test("concurrent payments and reversals keep the customer balance and audit trail consistent", async ({ request }) => {
  const admin = await headers(request, scope.admin);
  const user = await newCustomer(request, admin, "Payment Race");
  const profile = await prisma.customerProfile.findUniqueOrThrow({ where: { userId: user.id } });
  const responses = await Promise.all(Array.from({ length: 12 }, (_, index) => request.post("/api/bills", { headers: admin,
    data: { customerProfileId: profile.id, amount: 7.5, paymentMethod: "UPI", reference: `PAYMENT-RACE-${index}` } })));
  expect(responses.map(response => response.status())).toEqual(Array(12).fill(201));
  const payments = await Promise.all(responses.map(async response => (await response.json()).payment));
  expect((await prisma.customerProfile.findUniqueOrThrow({ where: { id: profile.id } })).currentBalance).toBe(90);
  const reversals = await Promise.all(Array.from({ length: 12 }, () => request.delete(`/api/bills/${payments[0].id}`, { headers: admin })));
  expect(reversals.filter(response => response.status() === 200)).toHaveLength(1);
  expect(reversals.filter(response => response.status() === 404)).toHaveLength(11);
  expect(await prisma.auditLog.count({ where: { recordId: payments[0].id, action: "PAYMENT_REVERSED" } })).toBe(1);
  expect((await prisma.customerProfile.findUniqueOrThrow({ where: { id: profile.id } })).currentBalance).toBe(82.5);
  const remaining = await Promise.all(payments.slice(1).map(payment => request.delete(`/api/bills/${payment.id}`, { headers: admin })));
  expect(remaining.map(response => response.status())).toEqual(Array(11).fill(200));
  const final = await prisma.customerProfile.findUniqueOrThrow({ where: { id: profile.id } });
  expect(final.currentBalance).toBe(0); expect(final.totalPayments).toBe(0);
  expect(await prisma.payment.count({ where: { customerProfileId: profile.id } })).toBe(0);
});
