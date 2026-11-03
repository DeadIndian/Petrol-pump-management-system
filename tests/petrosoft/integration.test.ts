import assert from "node:assert/strict";
import { after, test } from "node:test";
import { jsonFields } from "../../lib/petrosoft/catalog";
import { ids, runtime, station } from "./helpers";

after(async () => { const api = await runtime(); await api.db.$disconnect(); });

test("meter, credit, recovery, POS, and expenses preserve cash and customer balances through edits and reversals", async () => {
  const s = await station();
  try {
    const date = "2026-01-02";
    const meter = ids(await s.submit("meter-sales", { insert_date: date, product: "1", tank_no: "T1", pump_id: "1", nozzle_id: "1", open_read: "1000", close_read: "1102", test_qty: "2", price: "100", employee: "1" }))[0];
    assert.equal((await s.entry(meter)).amount.toString(), "10000");
    const sale = ids(await s.submit("credit-sales", { insert_date: date, organiz: "1", product: "1", price: "100", qnty: "20", credit_discnt: "50", batta_amt: "100", credsale_emp: "1", vehi_no: "KA01TEST1", credit_billno: "1", indent_no: "1" }))[0];
    const recovery = ids(await s.submit("recoveries", { insert_date: date, rec_organiz: "1", rec_emp: "1", paid_amt: "1000", rec_disc_amt: "50", re_type: "Cash" }))[0];
    const swipe = ids(await s.submit("swipes", { insert_date: date, swipesale_emp: "1", swipe_bank: "1", swipe_amt: "500" }))[0];
    const expense = ids(await s.submit("expenses", { insert_date: date, employees: "1", exp_type: "1", exp_amt: "200", flow: "Outflow", exp_paytype: "Cash" }))[0];
    let state = await s.readState(s.actor, "dashboard", { date });
    assert.equal(state.balances.customer["1"].balance, "1000");
    assert.equal(state.cashClosing, "8200");
    await s.submit("credit-sales", { qnty: "10", credit_discnt: "0", batta_amt: "0" }, sale);
    state = await s.readState(s.actor, "dashboard", { date });
    assert.equal(state.balances.customer["1"].balance, "-50");
    assert.equal(state.cashClosing, "9300");
    for (const [module, id] of [["recoveries", recovery], ["swipes", swipe], ["expenses", expense], ["credit-sales", sale], ["meter-sales", meter]]) await s.action({ module, operation: "delete", id });
    state = await s.readState(s.actor, "dashboard", { date });
    assert.equal(state.cashClosing, "0");
    assert.equal(state.balances.customer?.["1"]?.balance || "0", "0");
    assert.ok(await s.db.petrosoftAudit.count({ where: { workspaceId: s.workspace.id, action: "DELETE" } }) >= 5);
  } finally { await s.cleanup(); }
});

test("dated stock and cash snapshots carry backdated changes forward and reverse them", async () => {
  const s = await station();
  try {
    const first = ids(await s.submit("opening-stock", { insert_date: "2026-02-01", tank_no: "T1", open_stock: "1000", receipt: "0", meter_sale: "0", dip_stock: "1000" }))[0];
    const second = ids(await s.submit("opening-stock", { insert_date: "2026-02-02", tank_no: "T1", open_stock: "1000", receipt: "0", meter_sale: "0", dip_stock: "1000" }))[0];
    await s.submit("opening-stock", { open_stock: "1200", dip_stock: "1200" }, first);
    assert.equal(jsonFields((await s.entry(second)).fields).open_stock, "1200");
    const meter = ids(await s.submit("meter-sales", { insert_date: "2026-02-01", product: "1", tank_no: "T1", pump_id: "1", nozzle_id: "1", open_read: "0", close_read: "10", test_qty: "0", price: "100", employee: "1" }))[0];
    assert.equal(jsonFields((await s.entry(second)).fields).open_stock, "1190");
    const settlement1 = ids(await s.submit("settlements", { insert_date: "2026-02-01", opencash: "0" }))[0];
    const settlement2 = ids(await s.submit("settlements", { insert_date: "2026-02-02", opencash: "1000" }))[0];
    await s.submit("meter-sales", { close_read: "20" }, meter);
    assert.equal(jsonFields((await s.entry(settlement1)).fields).closecash, "2000");
    assert.equal(jsonFields((await s.entry(settlement2)).fields).opencash, "2000");
    assert.equal(jsonFields((await s.entry(second)).fields).open_stock, "1180");
    await s.action({ module: "meter-sales", operation: "delete", id: meter });
    assert.equal(jsonFields((await s.entry(settlement2)).fields).closecash, "0");
    assert.equal(jsonFields((await s.entry(second)).fields).open_stock, "1200");
    await s.action({ module: "opening-stock", operation: "delete", id: first });
    assert.equal(jsonFields((await s.entry(second)).fields).open_stock, "0");
  } finally { await s.cleanup(); }
});

test("purchases aggregate dealer commission once, link vendor and bank rows, and reverse all postings", async () => {
  const s = await station();
  try {
    const purchase = ids(await s.submit("fuel-purchases", { pur_date: "2026-03-01", invo_no: "INV-1", liq_vendor: "1", Payment: "yes", payment_amnt: "500", payment_bank: "1|Bank|3|3", roundingoff: "1", rows: [{ prod_code: "1", pro_qty: "10", purrate: "100", purvat: "200", purtcs: "12", lfr: "10", dealercomm: "20", othertxs: "0", tank_no: "T1" }] }))[0];
    assert.equal((await s.entry(purchase)).amount.toString(), "1203");
    let balance = await s.balanceMap(s.workspace.id, new Date("2026-03-01"));
    assert.equal(balance.vendor["1"].balance, "-703");
    assert.equal(balance.bank["1"].balance, "-500");
    const linked = await s.db.petrosoftEntry.findMany({ where: { workspaceId: s.workspace.id, fields: { path: ["parent_id"], equals: purchase }, status: "active" } });
    assert.equal(linked.length, 3);
    await assert.rejects(s.action({ module: "vendor-transactions", operation: "delete", id: linked.find(row => row.module === "vendor-transactions")!.id }), /original transaction/);
    await s.submit("fuel-purchases", { Payment: "yes", payment_amnt: "600" }, purchase);
    balance = await s.balanceMap(s.workspace.id, new Date("2026-03-01"));
    assert.equal(balance.vendor["1"].balance, "-603");
    assert.equal(balance.bank["1"].balance, "-600");
    await s.action({ module: "fuel-purchases", operation: "delete", id: purchase });
    balance = await s.balanceMap(s.workspace.id, new Date("2026-03-01"));
    assert.equal(balance.vendor?.["1"]?.balance || "0", "0");
    assert.equal(balance.bank?.["1"]?.balance || "0", "0");
  } finally { await s.cleanup(); }
});

test("meter uniqueness and tank relationships are enforced within a batch and across concurrent saves", async () => {
  const s = await station();
  try {
    const fields = { insert_date: "2026-04-01", product: "1", tank_no: "T1", pump_id: "1", nozzle_id: "1", open_read: "0", close_read: "10", price: "100", employee: "1" };
    await assert.rejects(s.submit("meter-sales", { ...fields, rows: [fields, fields] }), /only once/);
    assert.equal(await s.db.petrosoftEntry.count({ where: { workspaceId: s.workspace.id, module: "meter-sales" } }), 0);
    await assert.rejects(s.submit("meter-sales", { ...fields, product: "2" }), /does not belong/);
    const responses = await Promise.allSettled([s.submit("meter-sales", fields), s.submit("meter-sales", fields)]);
    assert.equal(responses.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(await s.db.petrosoftEntry.count({ where: { workspaceId: s.workspace.id, module: "meter-sales", status: "active" } }), 1);
  } finally { await s.cleanup(); }
});

test("generated invoices freeze their source sales and cancellation makes those sales editable again", async () => {
  const s = await station();
  try {
    const sale = ids(await s.submit("credit-sales", { insert_date: "2026-05-01", organiz: "1", product: "1", price: "100", qnty: "1", credsale_emp: "1" }))[0];
    const result = await s.action({ module: "sale-invoices", operation: "generate", ids: [sale], fields: { invoice_date: "2026-05-01" } }) as { documents: { id: string }[] };
    await assert.rejects(s.submit("credit-sales", { qnty: "2" }, sale), /Cancel/);
    await assert.rejects(s.action({ module: "credit-sales", operation: "delete", id: sale }), /Cancel/);
    await s.action({ module: "generated-invoices", operation: "delete", id: result.documents[0].id });
    await s.submit("credit-sales", { qnty: "2" }, sale);
    assert.equal((await s.entry(sale)).amount.toString(), "200");
  } finally { await s.cleanup(); }
});

test("purchase invoice aliases retain their identity and reject duplicates on creation and editing", async () => {
  const s = await station();
  try {
    const fields = { pur_date: "2026-05-01", lub_vendor: "1", Payment: "no", rows: [{ pur_proname1: "1", pur_proqty: "10", pur_prorate: "100", pur_disc: "0", pur_igst: "180" }] };
    const first = ids(await s.submit("lubricant-purchases", { ...fields, invoiceno: "SOURCE-LUB-1" }))[0];
    assert.equal(jsonFields((await s.entry(first)).fields).invo_no, "SOURCE-LUB-1");
    await assert.rejects(s.submit("lubricant-purchases", { ...fields, invoiceno: "SOURCE-LUB-1" }), /already recorded/);
    const second = ids(await s.submit("lubricant-purchases", { ...fields, invoiceno: "SOURCE-LUB-2" }))[0];
    await assert.rejects(s.submit("lubricant-purchases", { invoiceno: "SOURCE-LUB-1" }, second), /already recorded/);
    assert.equal(jsonFields((await s.entry(second)).fields).invo_no, "SOURCE-LUB-2");
    await s.seed("lubricant-purchases", 99, "Legacy invoice", { invoiceno: "LEGACY-LUB-1" });
    await assert.rejects(s.submit("lubricant-purchases", { ...fields, invoiceno: "LEGACY-LUB-1" }), /already recorded/);
    assert.equal((await s.balanceMap(s.workspace.id, new Date("2026-05-01"))).product["lub:1"].quantity, "20");
  } finally { await s.cleanup(); }
});

test("editing sale-rate dates cannot create duplicate prices for the same product and day", async () => {
  const s = await station();
  try {
    const fields = { product: "1", new_rate: "100", cls_rate: "100" };
    await s.submit("daily-rates", { ...fields, insert_date: "2026-05-01" });
    const second = ids(await s.submit("daily-rates", { ...fields, insert_date: "2026-05-02" }))[0];
    await assert.rejects(s.submit("daily-rates", { insert_date: "2026-05-01" }, second), /already exists/);
    assert.equal((await s.entry(second)).date.toISOString().slice(0, 10), "2026-05-02");
    assert.equal(await s.db.petrosoftEntry.count({ where: { workspaceId: s.workspace.id, module: "daily-rates" } }), 2);
  } finally { await s.cleanup(); }
});

test("lubricant cash sales accept an empty customer and mixed batches still require credit customers", async () => {
  const s = await station();
  try {
    const fields = { insert_date: "2026-05-01", "pro_name2[]": ["1", "1"], "pro_rate1[]": ["200", "200"], "emp_rate[]": ["200", "200"], "pro_qty1[]": ["2", "1"], "pro_amt1[]": ["400", "200"], "prodsale_emp[]": ["1", "1"], "sale_type1[]": ["Cash", "Credit"], "org_name[]": ["", "1"] };
    await s.action({ module: "lubricant-sales", formIndex: 1, fields });
    const balances = await s.balanceMap(s.workspace.id, new Date("2026-05-01"));
    assert.equal(balances.cash.cash.balance, "400"); assert.equal(balances.customer["1"].balance, "200");
    await assert.rejects(s.action({ module: "lubricant-sales", formIndex: 1, fields: { ...fields, "org_name[]": ["", ""] } }), /active customers/);
    assert.deepEqual(await s.balanceMap(s.workspace.id, new Date("2026-05-01")), balances);
  } finally { await s.cleanup(); }
});

test("bowser fuel and lubricant sales can be billed without duplicating account movements", async () => {
  const s = await station();
  try {
    const date = "2026-05-01";
    await s.seed("bowsers", 1, "Delivery Bowser", { b_name: "Delivery Bowser", product: "1", capacity: "1000" });
    const fuel = ids(await s.submit("bowser-credit-sales", { insert_date: date, Bowser_Crd: "1", organiz: "1", product: "1", price: "100", qnty: "1", credsale_emp: "1" }))[0];
    const oil = ids(await s.submit("bowser-lubricant-sales", { insert_date: date, Bowser_lub: "1", org_name: "1", pro_name2: "1", pro_qty1: "2", pro_rate1: "200", sale_type1: "Credit", prodsale_emp: "1", lubvehi_no: "KA01TEST1" }))[0];
    const before = await s.balanceMap(s.workspace.id, new Date(date));
    const pending = await s.readState(s.actor, "sale-invoices", { date, from: date, to: date });
    assert.deepEqual(pending.records.map(entry => entry.id).sort(), [fuel, oil].sort());
    const generated = await s.action({ module: "sale-invoices", operation: "generate", ids: [fuel, oil], fields: { invoice_date: date } }) as { documents: { id: string }[] };
    assert.equal(generated.documents.length, 1); assert.equal((await s.entry(generated.documents[0].id)).amount.toString(), "500");
    assert.deepEqual(await s.balanceMap(s.workspace.id, new Date(date)), before);
    await assert.rejects(s.submit("bowser-credit-sales", { qnty: "2" }, fuel), /Cancel/);
    await assert.rejects(s.submit("bowser-lubricant-sales", { pro_qty1: "3" }, oil), /Cancel/);
    assert.equal((await s.readState(s.actor, "sale-invoices", { date, from: date, to: date })).records.length, 0);
  } finally { await s.cleanup(); }
});

test("bowser transfers preserve station stock and cash, carry readings, and reject dependent edits", async () => {
  const s = await station();
  try {
    const date = "2026-05-01", tomorrow = "2026-05-02";
    await s.seed("employees", 2, "Driver", { emp_name: "Driver" });
    await s.seed("bowsers", 1, "Delivery Bowser", { b_name: "Delivery Bowser", product: "1", capacity: "1000" });
    const nozzle = await s.seed("bowser-nozzles", 1, "BN1", { nozzle_name: "BN1", bowser: "1", open_read: "0" });
    await s.submit("fuel-purchases", { pur_date: date, liq_vendor: "1", invo_no: "BOW-PUR-1", rows: [{ prod_code: "1", tank_no: "T1", pro_qty: "1000", purrate: "50" }] });
    const meter = ids(await s.submit("meter-sales", { insert_date: date, product: "1", tank_no: "T1", pump_id: "1", nozzle_id: "1", open_read: "0", close_read: "100", price: "100", employee: "1" }))[0];
    const fields = { insert_date: date, emp_id: "2", bowser: "1", opening: "0", "rec_noz[]": ["1"], "rec_qty[]": ["50"], "bow_nozzle[]": ["1"], "openread[]": ["0"], "closeread[]": ["40"], "test[]": ["0"], "rate[]": ["100"] };
    const day = ids(await s.action({ module: "bowser-sales", formIndex: 1, fields }))[0];
    const balances = await s.balanceMap(s.workspace.id, new Date(date));
    assert.equal(balances.cash.cash.balance, "9000");
    assert.equal(balances.employee["1"].balance, "5000"); assert.equal(balances.employee["2"].balance, "4000");
    assert.equal(balances.bowser["1"].quantity, "10"); assert.equal(balances.product["1"].quantity, "910");
    assert.equal((await s.tankStock(s.workspace.id, new Date(date)))[0].fields.close_stock, "900");
    assert.equal(jsonFields((await s.entry(day)).fields).closing, "10");
    const settlement = await s.readState(s.actor, "settlements", { date });
    assert.equal(settlement.summary.hand_cash, "9000"); assert.equal(settlement.summary.meter_quantity, "90");
    const dashboard = await s.readState(s.actor, "dashboard", { date, dashboard_product: "1" });
    assert.equal(dashboard.monthlyTrends?.[0].sale, "90");
    await assert.rejects(s.submit("meter-sales", { close_read: "110" }, meter), /Reverse the bowser receipt/);
    await assert.rejects(s.action({ module: "meter-sales", operation: "delete", id: meter }), /Reverse the bowser receipt/);
    await assert.rejects(s.action({ module: "bowser-nozzles", operation: "delete", id: nozzle.id }), /used by existing transactions/);
    await assert.rejects(s.action({ module: "bowser-sales", formIndex: 1, fields }), /already has a sale entry/);
    await assert.rejects(s.action({ module: "bowser-sales", formIndex: 1, id: day, fields: { ...fields, "rec_qty[]": ["101"] } }), /exceeds unallocated/);
    await assert.rejects(s.action({ module: "bowser-sales", formIndex: 1, id: day, fields: { ...fields, "closeread[]": ["60"] } }), /exceed available/);
    assert.deepEqual(await s.balanceMap(s.workspace.id, new Date(date)), balances);
    await s.action({ module: "bowser-sales", formIndex: 1, id: day, fields: { ...fields, "closeread[]": ["45"] } });
    assert.equal((await s.balanceMap(s.workspace.id, new Date(date))).cash.cash.balance, "9500");
    await s.action({ module: "bowser-sales", formIndex: 1, id: day, fields });
    assert.deepEqual(await s.balanceMap(s.workspace.id, new Date(date)), balances);
    const nextFields = { insert_date: tomorrow, emp_id: "2", bowser: "1", opening: "10", "rec_noz[]": [""], "rec_qty[]": [""], "bow_nozzle[]": ["1"], "openread[]": ["40"], "closeread[]": ["45"], "test[]": ["0"], "rate[]": ["100"] };
    const next = ids(await s.action({ module: "bowser-sales", formIndex: 1, fields: nextFields }))[0];
    const closing = await s.balanceMap(s.workspace.id, new Date(tomorrow));
    assert.equal(closing.bowser["1"].quantity, "5"); assert.equal(closing.product["1"].quantity, "905"); assert.equal(closing.cash.cash.balance, "9500");
    const state = await s.readState(s.actor, "bowser-sales", { date: "2026-05-03" });
    assert.equal(state.bowsers[0].opening, "5"); assert.equal(state.bowsers[0].nozzles[0].opening, "45");
    await assert.rejects(s.action({ module: "bowser-sales", operation: "delete", id: day }), /Reverse later bowser days/);
    await s.action({ module: "bowser-sales", operation: "delete", id: next });
    await s.action({ module: "bowser-sales", operation: "delete", id: day });
    const reversed = await s.balanceMap(s.workspace.id, new Date(tomorrow));
    assert.equal(reversed.cash.cash.balance, "10000"); assert.equal(reversed.bowser?.["1"]?.quantity || "0", "0"); assert.equal(reversed.product["1"].quantity, "900");
    await s.action({ module: "meter-sales", operation: "delete", id: meter });
    assert.equal((await s.tankStock(s.workspace.id, new Date(tomorrow)))[0].fields.close_stock, "1000");
  } finally { await s.cleanup(); }
});

test("bowser lubricant cash sales accept empty vehicles and credit sales validate them per row", async () => {
  const s = await station();
  try {
    await s.seed("bowsers", 1, "Delivery Bowser", { b_name: "Delivery Bowser", product: "1", capacity: "1000" });
    const fields = { insert_date: "2026-05-01", "Bowser_lub[]": ["1"], "pro_name2[]": ["1"], "pro_rate1[]": ["200"], "emp_rate[]": ["200"], "pro_qty1[]": ["2"], "pro_amt1[]": ["400"], "prodsale_emp[]": ["1"], "sale_type1[]": ["Cash"], "org_name[]": [""], "lubvehi_no[]": [""] };
    await s.action({ module: "bowser-lubricant-sales", formIndex: 1, fields });
    const balance = await s.balanceMap(s.workspace.id, new Date("2026-05-01"));
    assert.equal(balance.cash.cash.balance, "400");
    await assert.rejects(s.action({ module: "bowser-lubricant-sales", formIndex: 1, fields: { ...fields, "sale_type1[]": ["Credit"], "org_name[]": ["1"] } }), /vehicle number/);
    await assert.rejects(s.action({ module: "bowser-lubricant-sales", formIndex: 1, fields: { ...fields, "Bowser_lub[]": ["other-station"] } }), /belonging to this station/);
    assert.deepEqual(await s.balanceMap(s.workspace.id, new Date("2026-05-01")), balance);
  } finally { await s.cleanup(); }
});

test("payroll uses duty multipliers, freezes generation, and posts a salary payment only once", async () => {
  const s = await station();
  try {
    await s.submit("attendance", { insert_date: "2026-06-01", shift: "General", rows: [{ employee: "1", attend_type: "P", attend_remark: "Paid", hours: "8" }] });
    const preview = await s.action({ module: "payroll", operation: "preview-payroll", fields: { month: "2026-06" } }) as { rows: { total_duties: string; total_salary: string }[] };
    assert.equal(preview.rows[0].total_duties, "2");
    assert.equal(preview.rows[0].total_salary, "1000");
    const payroll = ids(await s.action({ module: "payroll", operation: "save", fields: { month: "2026-06", payment_date: "2026-06-30" } }))[0];
    await assert.rejects(s.action({ module: "payroll", operation: "save", fields: { month: "2026-06" } }), /already generated/);
    await s.action({ module: "payroll", operation: "pay", id: payroll, fields: { payment_date: "2026-06-30" } });
    assert.equal((await s.balanceMap(s.workspace.id, new Date("2026-06-30"))).cash.cash.balance, "-1000");
    await assert.rejects(s.action({ module: "payroll", operation: "pay", id: payroll, fields: {} }), /already been paid/);
    await s.action({ module: "payroll", operation: "delete", id: payroll });
    assert.equal((await s.balanceMap(s.workspace.id, new Date("2026-06-30"))).cash.cash.balance, "0");
  } finally { await s.cleanup(); }
});

test("loan repayments use accrued interest, prevent overpayment, and restore principal on reversal", async () => {
  const s = await station();
  try {
    const loan = ids(await s.submit("interest", { trans_dt: "2026-01-01", partytype: "1|Bank", Topartytype: "2|Owner", trans_amnt: "10000", interest: "10", loan: "new" }))[0];
    const preview = await s.action({ module: "interest", operation: "preview-loan", fields: { trans_dt: "2026-02-06", loan } }) as { loan_balance: string; interest_payable: string };
    assert.equal(preview.loan_balance, "10000");
    assert.equal(preview.interest_payable, "98.63");
    await assert.rejects(s.submit("interest", { trans_dt: "2026-02-06", loan, principal_repay: "10001", interest_repay: "0" }), /cannot exceed/);
    const repayment = ids(await s.submit("interest", { trans_dt: "2026-02-06", loan, principal_repay: "1000", interest_repay: "98.63" }))[0];
    assert.equal(jsonFields((await s.entry(loan)).fields).balance_amount, "9000");
    await assert.rejects(s.action({ module: "interest", operation: "delete", id: loan }), /repayments/);
    await s.action({ module: "interest", operation: "delete", id: repayment });
    assert.equal(jsonFields((await s.entry(loan)).fields).balance_amount, "10000");
  } finally { await s.cleanup(); }
});

test("authorization rejects cross-workspace entries and keeps an active Super Admin", async () => {
  const s = await station(), other = await station();
  try {
    const foreign = (await other.db.petrosoftEntry.findFirstOrThrow({ where: { workspaceId: other.workspace.id, module: "customers" } })).id;
    await assert.rejects(s.action({ module: "customers", operation: "delete", id: foreign }), /do not belong/);
    const limited = { ...s.actor, permissions: ["dashboard:view", "credit-sales:view"] };
    await assert.rejects(s.executeAction(limited, { module: "credit-sales", operation: "save", fields: {} }), /permission/);
    const admin = (await s.db.petrosoftEntry.findFirstOrThrow({ where: { workspaceId: s.workspace.id, module: "users" } })).id;
    await assert.rejects(s.action({ module: "users", operation: "delete", id: admin }), /own account/);
  } finally { await s.cleanup(); await other.cleanup(); }
});
