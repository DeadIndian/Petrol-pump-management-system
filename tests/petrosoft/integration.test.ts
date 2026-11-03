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
    const purchase = ids(await s.submit("fuel-purchases", { pur_date: "2026-03-01", invo_no: "INV-1", liq_vendor: "1", Payment: "yes", payment_amnt: "500", payment_bank: "1", roundingoff: "1", rows: [{ prod_code: "1", pro_qty: "10", purrate: "100", purvat: "200", purtcs: "12", lfr: "10", dealercomm: "20", othertxs: "0", tank_no: "T1" }] }))[0];
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
