import { Prisma, type PetrosoftEntry } from "@prisma/client";
import { hasPermission, type PetrosoftActor } from "./auth";
import { dateValue, fieldValue, jsonFields, masterIds, moduleById, today, type PetrosoftFields } from "./catalog";
import { petrosoftDb } from "./db";
import { baseModule, CUSTOMER_KEYS, EMPLOYEE_KEYS, money, PRODUCT_KEYS, quantity, safeFields, VENDOR_KEYS } from "./rules";
import { PetrosoftError } from "./actions";
import { cashAt } from "./cash";
import { hasMasterReferences } from "./masters";
import { bowserReadings } from "./bowser";

export interface QueryFilters extends PetrosoftFields { from?: string; to?: string; date?: string; search?: string; page?: number; limit?: number }
export type PublicEntry = Omit<ReturnType<typeof serializeEntry>, "fields"> & { fields: PetrosoftFields; deletionProtected?: boolean };
export type BalanceMap = Record<string, Record<string, { debit: string; credit: string; balance: string; quantity: string }>>;

export function serializeEntry(entry: PetrosoftEntry) {
  return { id: entry.id, module: entry.module, number: entry.number, externalId: entry.externalId || String(entry.number), name: entry.name,
    date: entry.date.toISOString().slice(0, 10), amount: entry.amount.toString(), quantity: entry.quantity.toString(), rate: entry.rate.toString(),
    status: entry.status, fields: safeFields(jsonFields(entry.fields)), createdBy: entry.createdBy,
    createdAt: entry.createdAt.toISOString(), updatedAt: entry.updatedAt.toISOString() };
}

export function dateRange(filters: PetrosoftFields, defaults = true) {
  const end = dateValue(fieldValue(filters, ["to", "to_dt", "search_to_dt", "date", "insert_date"], today().toISOString().slice(0, 10)));
  const beginning = fieldValue(filters, ["from", "frm_dt", "search_frm_dt", "lubfrm_dt"]);
  const start = beginning ? dateValue(beginning) : defaults ? new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1)) : new Date("1900-01-01T00:00:00Z");
  if (start > end) throw new PetrosoftError("The from date must be on or before the to date.");
  return { from: start, to: end };
}

export async function balanceMap(workspaceId: string, asOf: Date) {
  const groups = await petrosoftDb.petrosoftLedger.groupBy({ by: ["entityType", "entityId"],
    where: { date: { lte: asOf }, entry: { workspaceId, status: { not: "void" } } },
    _sum: { debit: true, credit: true, quantity: true } });
  const balances: BalanceMap = {};
  for (const group of groups) {
    const debit = money(group._sum.debit || 0), credit = money(group._sum.credit || 0);
    (balances[group.entityType] ||= {})[group.entityId] = { debit: debit.toString(), credit: credit.toString(), balance: debit.sub(credit).toString(), quantity: quantity(group._sum.quantity || 0).toString() };
  }
  const cash = await cashAt(petrosoftDb,workspaceId,asOf);
  balances.cash ||= {}; balances.cash.cash = { debit: cash.toString(), credit: '0', balance: cash.toString(), quantity: '0' };
  return balances;
}

export async function latestRates(workspaceId: string, asOf: Date) {
  const entries = await petrosoftDb.petrosoftEntry.findMany({ where: { workspaceId, module: "daily-rates", status: { not: "void" }, date: { lte: asOf } }, orderBy: [{ date: "desc" }, { number: "desc" }], take: 1000 });
  const rates: Record<string, { opening: string; closing: string; date: string; id: string }> = {};
  for (const entry of entries) {
    const fields = jsonFields(entry.fields), product = fieldValue(fields, PRODUCT_KEYS);
    if (product && !rates[product]) rates[product] = { opening: entry.rate.toString(), closing: fieldValue(fields, "cls_rate", entry.rate.toString()), date: entry.date.toISOString().slice(0, 10), id: entry.id };
  }
  return rates;
}

export async function mastersFor(workspaceId: string) {
  const records = await petrosoftDb.petrosoftEntry.findMany({ where: { workspaceId,
    module: { in: [...masterIds, "nozzles", "vehicles", "customer-discounts", "employee-benefits", "employee-loans", "expiry-categories", "expiry-renewals", "bowsers", "bowser-nozzles", "calibration", "godowns"] }, status: { not: "void" } }, orderBy: [{ name: "asc" }, { number: "asc" }] });
  const masters: Record<string, PublicEntry[]> = {};
  for (const entry of records) (masters[entry.module] ||= []).push(serializeEntry(entry));
  return masters;
}

export function matchesFilters(entry: PublicEntry, filters: PetrosoftFields) {
  const f = entry.fields as PetrosoftFields;
  const selected = (names: string[]) => fieldValue(filters, names).split("|")[0];
  const customer = selected(["customer", "customer_id", "organizq", "credit_org", "organiz", "organn", "organnn", "org", "org_id"]);
  if (customer && customer !== "all" && customer !== "0" && fieldValue(f, CUSTOMER_KEYS) !== customer) return false;
  const product = selected(["product", "selct_prod", "proname", "prod_id", "stock_prod"]);
  if (product && product !== "all" && product !== "0" && fieldValue(f, PRODUCT_KEYS) !== product) return false;
  const employee = selected(["employee", "emp_id", "employee_id", "emloye", "lubemp_id"]);
  if (employee && employee !== "all" && employee !== "0" && fieldValue(f, EMPLOYEE_KEYS) !== employee) return false;
  const vendor = selected(["vendor", "vend_namee", "vendor_id"]);
  if (vendor && vendor !== "all" && fieldValue(f, VENDOR_KEYS) !== vendor) return false;
  const machine = selected(["swpp_bank", "swipe_bank"]);
  if (machine && machine !== "all" && fieldValue(f, ["swipe_bank", "swipe_name"]) !== machine) return false;
  const shift = selected(["shift", "selct_shift"]);
  if (shift && shift !== "all" && fieldValue(f, "shift") !== shift) return false;
  const bowser = selected(["bowser", "bowser_id"]);
  if (bowser && bowser !== "all" && bowser !== "0" && fieldValue(f, "bowser") !== bowser) return false;
  const vehicle = selected(["vehicle", "vehi_no", "vehicle_no"]);
  if (vehicle && vehicle !== "all" && fieldValue(f, ["vehi_no", "vehicle_no", "lubvehi_no"]) !== vehicle) return false;
  const flow = selected(["flow", "seachflow"]);
  if (flow && flow !== "all" && fieldValue(f, "flow").toLowerCase() !== flow.toLowerCase()) return false;
  const search = fieldValue(filters, ["search", "q"]).toLowerCase();
  return !search || JSON.stringify(entry).toLowerCase().includes(search);
}

export async function transactionRecords(workspaceId: string, moduleIds: string[], filters: PetrosoftFields = {}, defaults = true) {
  const range = dateRange(filters, defaults);
  const entries = await petrosoftDb.petrosoftEntry.findMany({ where: { workspaceId, module: { in: moduleIds }, status: { not: "void" }, date: { gte: range.from, lte: range.to } }, orderBy: [{ date: "desc" }, { number: "desc" }] });
  return entries.map(serializeEntry).filter(entry => matchesFilters(entry, filters));
}

export function displayNames(entry: PublicEntry, masters: Record<string, PublicEntry[]>, balances: BalanceMap = {}) {
  const fields = { ...entry.fields } as PetrosoftFields;
  const lookup = (module: string, id: string) => (masters[module] || []).find(record => record.externalId === id || record.id === id || record.name === id);
  const product = fieldValue(fields, PRODUCT_KEYS), customer = fieldValue(fields, CUSTOMER_KEYS), employee = fieldValue(fields, EMPLOYEE_KEYS), vendor = fieldValue(fields, VENDOR_KEYS);
  const productModule = /lubricant/.test(entry.module) ? "lubricants" : /gift/.test(entry.module) ? "gifts" : "fuel-products";
  fields.product_name = lookup(productModule, product)?.name || fields.product_name || product;
  fields.organization_name = lookup("customers", customer)?.name || fields.organization_name || customer;
  fields.employee_name = lookup("employees", employee)?.name || fields.employee_name || employee;
  fields.vendor_name = lookup("vendors", vendor)?.name || fields.vendor_name || vendor;
  fields.swipe_name = lookup("swipe-machines", fieldValue(fields, "swipe_bank"))?.name || fields.swipe_name;
  fields.expense_name = lookup("expense-types", fieldValue(fields, "exp_type"))?.name || fields.expense_name;
  fields.tank_name = lookup("tanks", fieldValue(fields, ["tank_no", "stock_tank"]))?.name || (masters.tanks || []).find(tank => fieldValue(tank.fields as PetrosoftFields, "tank_no") === fieldValue(fields, ["tank_no", "stock_tank"]))?.name || fields.tank_no;
  fields.nozzle_name = lookup("nozzles", fieldValue(fields, ["nozzle_id", "nozzle", "noz"]))?.name || fields.nozzle_name;
  if (["customers", "vendors", "business-parties", "swipe-machines", "employees", "guests"].includes(entry.module)) {
    const type = entry.module === "customers" ? "customer" : entry.module === "vendors" ? "vendor" : entry.module === "employees" ? "employee" : entry.module === "guests" ? "loyalty" : entry.module === "swipe-machines" ? "swipe" : /bank/i.test(fieldValue(fields, "p_type")) ? "bank" : "party";
    fields.balance = balances[type]?.[entry.externalId]?.balance || "0";
    if (type === "loyalty") fields.points_balance = balances.loyalty?.[entry.externalId]?.quantity || "0";
  }
  return { ...entry, fields };
}

export async function tankStock(workspaceId: string, asOf: Date, masters?: Record<string, PublicEntry[]>) {
  const masterData = masters || await mastersFor(workspaceId);
  const snapshots = await petrosoftDb.petrosoftEntry.findMany({ where: { workspaceId, module: "opening-stock", date: { lte: asOf }, status: { not: "void" } }, orderBy: [{ date: "desc" }, { number: "desc" }] });
  const movements = await petrosoftDb.petrosoftLedger.findMany({ where: { entityType: "tank", date: { lte: asOf }, entry: { workspaceId, status: { not: "void" } } }, include: { entry: { select: { module: true, fields: true } } } });
  const stocks = [];
  for (const tank of masterData.tanks || []) {
    const tankFields = tank.fields as PetrosoftFields, tankNo = fieldValue(tankFields, "tank_no", tank.externalId);
    const snapshot = snapshots.find(entry => fieldValue(jsonFields(entry.fields), ["tank_no", "stock_tank"]) === tankNo);
    const fields = jsonFields(snapshot?.fields);
    const sameDay = snapshot?.date.getTime() === asOf.getTime();
    let opening = quantity(fieldValue(fields, sameDay ? ["open_stock", "opening_stock"] : ["close_stock", "closing_stock", "open_stock"], "0"));
    let receipt = quantity(sameDay ? fieldValue(fields, "receipt", "0") : "0"), sale = quantity(sameDay ? fieldValue(fields, "meter_sale", "0") : "0");
    for (const movement of movements.filter(item => item.entityId === tankNo && (!snapshot || item.date > snapshot.date))) {
      if (movement.date < asOf) opening = opening.add(movement.quantity);
      else if (movement.quantity.gt(0)) receipt = receipt.add(movement.quantity); else sale = sale.sub(movement.quantity);
    }
    const closing = quantity(opening.add(receipt).sub(sale));
    stocks.push({ id: snapshot?.id || tank.id, module: "stock", number: tank.number, externalId: tank.externalId, name: tank.name, date: asOf.toISOString().slice(0, 10), amount: "0", quantity: closing.toString(), rate: "0", status: "active", createdBy: snapshot?.createdBy || "", createdAt: snapshot?.createdAt.toISOString() || "", updatedAt: snapshot?.updatedAt.toISOString() || "",
      fields: { ...fields, tank_no: tankNo, tank_name: tank.name, product: fieldValue(tankFields, ["pro_name", "product"]), capacity: tankFields.tank_cap,
        open_stock: opening.toString(), receipt: receipt.toString(), total_stk: opening.add(receipt).toString(), meter_sale: sale.toString(), close_stock: closing.toString(), dip_stock: sameDay ? fieldValue(fields, "dip_stock", closing.toString()) : closing.toString() } });
  }
  return stocks;
}

export async function nozzleReadings(workspaceId: string, asOf: Date, masters: Record<string, PublicEntry[]>, rates: Awaited<ReturnType<typeof latestRates>>) {
  const meters = await petrosoftDb.petrosoftEntry.findMany({ where: { workspaceId, module: "meter-sales", date: { lte: asOf }, status: { not: "void" } }, orderBy: [{ date: "desc" }, { number: "desc" }] });
  return (masters["pump-settings"] || []).filter(pump => pump.status === "active").map(pump => {
    const f = pump.fields as PetrosoftFields, nozzleId = fieldValue(f, ["noz", "nozzel_id"]), nozzle = (masters.nozzles || []).find(item => item.externalId === nozzleId), nf = nozzle?.fields as PetrosoftFields || {};
    const product = fieldValue(f, ["product", "prod_id"], fieldValue(nf, "product"));
    const previous = meters.find(entry => entry.date < asOf && fieldValue(jsonFields(entry.fields), ["nozzle_id", "nozzle"]) === nozzleId);
    const existing = meters.find(entry => entry.date.getTime() === asOf.getTime() && fieldValue(jsonFields(entry.fields), ["nozzle_id", "nozzle"]) === nozzleId);
    return { id: nozzleId, pumpId: pump.externalId, pump: fieldValue(f, "pump_name"), name: nozzle?.name || nozzleId,
      tank: fieldValue(f, "tank_no", fieldValue(nf, "tank_no")), product,
      opening: fieldValue(jsonFields(previous?.fields), "close_read", "0"), rate: rates[product]?.closing || "0", employee: fieldValue(jsonFields(previous?.fields), EMPLOYEE_KEYS), existingId: existing?.id || "" };
  });
}

export function dailySummary(records: PublicEntry[]) {
  const groups: Record<string, Record<string, string>> = {};
  const add = (row: Record<string, string>, key: string, value: unknown) => { row[key] = money(row[key] || 0).add(money(value || 0)).toString(); };
  for (const entry of records) {
    const f = entry.fields as PetrosoftFields, moduleSchema = baseModule(entry.module), row = groups[entry.date] ||= { date: entry.date };
    if (moduleSchema === "meter-sales") { add(row, "meter_sale", money(entry.amount).sub(entry.module === "bowser-sales" ? fieldValue(f, "receipt_amount", "0") : 0)); add(row, "meter_quantity", quantity(entry.quantity).sub(entry.module === "bowser-sales" ? fieldValue(f, "receipt", "0") : 0)); add(row, "testing", fieldValue(f, "test_qty", "0")); }
    if (moduleSchema === "lubricant-sales" && !/credit/i.test(fieldValue(f, ["sale_type1", "sale_type"]))) add(row, "lubricant_sale", entry.amount);
    if (moduleSchema === "recoveries") {
      if (/cash/i.test(fieldValue(f, "re_type", "Cash"))) add(row, "recovery", entry.amount); else add(row, "bank_recovery", entry.amount);
    }
    if (moduleSchema === "expenses") {
      const cash = /cash/i.test(fieldValue(f, "exp_paytype", "Cash"));
      if (/inflow/i.test(fieldValue(f, "flow"))) add(row, cash ? "cash_in" : "bank_in", entry.amount);
      else add(row, cash ? "expenses" : "bank_expenses", entry.amount);
    }
    if (moduleSchema === "credit-sales") { add(row, "credit", entry.amount); add(row, "discount", fieldValue(f, ["discount", "credit_discnt"], "0")); }
    if (moduleSchema === 'fuel-purchases') add(row,'fuel_purchase',entry.amount);
    if (moduleSchema === 'lubricant-purchases') add(row,'lubricant_purchase',entry.amount);
    if (moduleSchema === "swipes") add(row, "swipe", entry.amount);
    if (moduleSchema === "employee-recoveries") { add(row, "collected", entry.amount); add(row, "shortage", fieldValue(f, "shortage", "0")); }
    if (moduleSchema === "settlements") { row.settlement = entry.id; row.closing_cash = fieldValue(f, "closecash", entry.amount); row.opening_cash = fieldValue(f, "opencash", "0"); row.pictures = fieldValue(f, "attachment_id"); }
  }
  return Object.values(groups).map((row): Record<string, string> & { date: string; total_cash: string; hand_cash: string } => {
    const total = money(row.meter_sale || 0).add(row.lubricant_sale || 0).add(row.recovery || 0).add(row.cash_in || 0);
    const cash = total.sub(row.swipe || 0).sub(row.credit || 0).sub(row.expenses || 0).sub(row.discount || 0);
    return { ...row, date: row.date, total_cash: total.toString(), hand_cash: cash.toString() };
  }).sort((a, b) => b.date.localeCompare(a.date));
}

async function virtualRecords(workspaceId: string, module: string, filters: PetrosoftFields, masters: Record<string, PublicEntry[]>, balances: BalanceMap) {
  const range = dateRange(filters);
  if (module === "credit-limits") return (masters.customers || []).map(record => ({ ...record, module, fields: { ...record.fields, balance: balances.customer?.[record.externalId]?.balance || "0" } }));
  if (["stock", "opening-stock", "sales-officer"].includes(module)) return transactionRecords(workspaceId, [module === "sales-officer" ? "sales-officer" : "opening-stock"], filters);
  if (["fuel-minimum-stock", "minimum-stock", "lubricant-stock"].includes(module)) {
    const stocks = await tankStock(workspaceId, range.to, masters);
    const movements = module === "fuel-minimum-stock" ? [] : await petrosoftDb.petrosoftLedger.findMany({ where: { entityType: "product", date: { lte: range.to }, entry: { workspaceId, status: { not: "void" } } }, include: { entry: { select: { module: true } } } });
    return (masters[module === "fuel-minimum-stock" ? "fuel-products" : "lubricants"] || []).map(record => {
      const productKey = module === "fuel-minimum-stock" ? record.externalId : `lub:${record.externalId}`;
      const present = module === "fuel-minimum-stock" ? stocks.filter(stock => stock.fields.product === record.externalId).reduce((sum, stock) => sum.add(stock.quantity), quantity(0)).toString() : balances.product?.[productKey]?.quantity || "0";
      const selected = movements.filter(post => post.entityId === productKey);
      const purchase = selected.filter(post => post.quantity.gt(0)).reduce((total, post) => total.add(post.quantity), quantity(0));
      const loss = selected.filter(post => /loss/.test(post.entry.module)).reduce((total, post) => total.sub(post.quantity), quantity(0));
      const sale = selected.filter(post => post.quantity.lt(0) && !/loss/.test(post.entry.module)).reduce((total, post) => total.sub(post.quantity), quantity(0));
      return { ...record, module, quantity: present, fields: { ...record.fields, product_name: record.name, present_stock: present, stock: present, purchase: purchase.toString(), sale: sale.toString(), loss: loss.toString() } };
    });
  }
  if (module === "expiry-list") return (masters["expiry-renewals"] || []).map(record => {
    const f = record.fields as PetrosoftFields, item = (masters["expiry-items"] || []).find(entry => entry.externalId === String(f.item_id)), category = (masters["expiry-categories"] || []).find(entry => entry.externalId === String(f.cat_id));
    return { ...record, module, fields: { ...f, item_name: item?.name || "", category_name: category?.name || "", expired: String(f.exp_date || "") < range.to.toISOString().slice(0, 10), alert: Number((dateValue(f.exp_date || range.to.toISOString().slice(0, 10)).getTime() - range.to.getTime()) / 86400000) <= Number(f.alert_days || 0) } };
  });
  if (module === "cash-flow") {
    const rows = await transactionRecords(workspaceId, ["meter-sales", "credit-sales", "lubricant-sales", "recoveries", "swipes", "expenses", "employee-recoveries", "settlements"], filters);
    return dailySummary(rows).map((fields, index) => ({ id: fields.date, module, number: index + 1, externalId: fields.date, name: fields.date, date: fields.date, amount: fields.hand_cash, quantity: "0", rate: "0", status: "active", fields, createdBy: "", createdAt: "", updatedAt: "" }));
  }
  if (module === "sheet-records") {
    const records = await transactionRecords(workspaceId, ["meter-sales", "credit-sales", "recoveries", "swipes", "expenses", "lubricant-sales"], filters);
    const groups = new Map<string, PublicEntry>();
    for (const entry of records) {
      const shift = fieldValue(entry.fields, "shift", "S-1"), key = `${entry.date}:${shift}:${entry.createdBy}`;
      const row = groups.get(key) || { ...entry, module, name: "Shift Sheet", fields: { shift, employee: fieldValue(entry.fields, EMPLOYEE_KEYS), modules: [], source_ids: [], entry_source: entry.createdBy } };
      row.fields.modules = [...new Set([...(row.fields.modules as string[]), moduleById.get(entry.module)?.title || entry.module])];
      (row.fields.source_ids as string[]).push(entry.id); groups.set(key, row);
    }
    return [...groups.values()];
  }
  return null;
}

export async function readState(actor: PetrosoftActor, moduleId: string, filters: QueryFilters = {}) {
  const moduleSchema = moduleById.get(moduleId);
  if (!moduleSchema || !hasPermission(actor, moduleId)) throw new PetrosoftError("Your role cannot open this module.", 403);
  const selectedDate = dateValue(fieldValue(filters, ["date", "insert_date", "to", "to_dt"], today().toISOString().slice(0, 10)));
  const [masters, balances, rates] = await Promise.all([mastersFor(actor.workspaceId), balanceMap(actor.workspaceId, selectedDate), latestRates(actor.workspaceId, selectedDate)]);
  let records: PublicEntry[] = [];
  let total = 0;
  const sources: Record<string, string> = { "credit-invoices": "credit-sales", "sale-invoices": "credit-sales", "generated-invoices": "generated-invoices", "statements": "statement-records" };
  if (moduleId === "audit") {
    const range = dateRange(filters), where = { workspaceId: actor.workspaceId, createdAt: { gte: range.from, lt: new Date(range.to.getTime() + 86400000) } };
    total = await petrosoftDb.petrosoftAudit.count({ where });
    const audits = await petrosoftDb.petrosoftAudit.findMany({ where, orderBy: { createdAt: "desc" }, take: Math.min(Number(filters.limit) || 1000, 5000), skip: (Math.max(1, Number(filters.page) || 1) - 1) * (Number(filters.limit) || 1000) });
    records = audits.map((audit, index) => ({ id: audit.id, module: "audit", number: index + 1, externalId: audit.id, name: audit.module, date: audit.createdAt.toISOString().slice(0, 10), amount: "0", quantity: "0", rate: "0", status: "active", fields: { module: audit.module, event: audit.action, entry_id: audit.entryId, username: audit.username, event_time: audit.createdAt.toISOString().slice(11, 19), created_date: audit.createdAt.toISOString(), before: audit.before, after: audit.after }, createdBy: audit.username, createdAt: audit.createdAt.toISOString(), updatedAt: audit.createdAt.toISOString() }));
  } else if (moduleSchema.kind === "master") {
    records = await Promise.all((masters[moduleId] || []).filter(entry => matchesFilters(entry, filters)).map(async entry => ({ ...entry,
      deletionProtected: await hasMasterReferences(petrosoftDb, { ...entry, workspaceId: actor.workspaceId, fields: entry.fields as Prisma.JsonObject }) })));
  }
  else {
    const virtual = await virtualRecords(actor.workspaceId, moduleId, filters, masters, balances);
    records = virtual || await transactionRecords(actor.workspaceId, [sources[moduleId] || moduleId], filters);
  }
  if (moduleId === "sale-invoices") records = (await transactionRecords(actor.workspaceId, ["credit-sales", "lubricant-sales", "guest-sales", "bowser-credit-sales", "bowser-lubricant-sales"], filters)).filter(entry => !fieldValue(entry.fields, "invoice_id"));
  if (moduleId === "attendance") {
    const details = await transactionRecords(actor.workspaceId, ["attendance-details"], filters);
    records = records.map(record => { const list = details.filter(detail => detail.date === record.date && (fieldValue(detail.fields as PetrosoftFields, "attend_id") === record.externalId || !fieldValue(detail.fields as PetrosoftFields, "attend_id"))); return { ...record, fields: { ...record.fields, presents: list.filter(item => fieldValue(item.fields as PetrosoftFields, "attend_type").startsWith("P")).length, absents: list.filter(item => fieldValue(item.fields as PetrosoftFields, "attend_type") === "A").length, details: list } }; });
  }
  const [stock, nozzles] = await Promise.all([tankStock(actor.workspaceId, selectedDate, masters), nozzleReadings(actor.workspaceId, selectedDate, masters, rates)]);
  const recent = ["dashboard", "settlements", "employee-recoveries", "shift-sheet"].includes(moduleId) ? await transactionRecords(actor.workspaceId, ["meter-sales", "credit-sales", "lubricant-sales", "recoveries", "swipes", "expenses", "bowser-sales", "bowser-credit-sales", "bowser-lubricant-sales", "bowser-recoveries", "bowser-swipes", "bowser-expenses", "employee-recoveries", "settlements",'fuel-purchases','lubricant-purchases'], { from: selectedDate.toISOString().slice(0, 10), to: selectedDate.toISOString().slice(0, 10) }) : [];
  const bowsers = moduleId === "bowser-sales" ? await bowserReadings(petrosoftDb, actor.workspaceId, selectedDate) : [];
  const dashboard: Partial<Awaited<ReturnType<typeof dashboardData>>> = moduleId === "dashboard" ? await dashboardData(actor.workspaceId, selectedDate, masters, filters) : {};
  if (moduleId === "eway-bills") records = await transactionRecords(actor.workspaceId, ["generated-invoices", "eway-bills"], filters);
  const tables: Record<string, PublicEntry[]> = {};
  if (moduleId === "expiry-items") { tables.example = masters["expiry-categories"] || []; tables.example0 = records; }
  if (moduleId === "expiry-list") { tables.toBeExpired = records.filter(record => Boolean((record.fields as PetrosoftFields).alert)); tables.example = records; }
  if (moduleId === "day-assignments") { tables.example = records; tables.example_1 = records.filter(record => fieldValue(record.fields as PetrosoftFields, "assign_type") === "nozzle"); }
  if (["sales-officer", "tanker-sales"].includes(moduleId)) for (const [index, tank] of (masters.tanks || []).entries()) tables[`${moduleId === "sales-officer" ? "soreport" : "tanker"}${index + 1}`] = records.filter(record => fieldValue(record.fields, "tank_no") === fieldValue(tank.fields, "tank_no", tank.externalId));
  const cashOpening = await cashAt(petrosoftDb,actor.workspaceId,selectedDate,true);
  return { records: records.map(entry => displayNames(entry, masters, balances)), total: total || records.length, tables,
    masters: Object.fromEntries(Object.entries(masters).map(([key, entries]) => [key, entries.map(entry => displayNames(entry, masters, balances))])),
    balances, rates, stock, nozzles, bowsers, date: selectedDate.toISOString().slice(0, 10), filters,
    summary: dailySummary(recent)[0] || {}, ...dashboard, settings: safeFields(jsonFields(actor.workspace.settings)), cashOpening: cashOpening.toString(), cashClosing: balances.cash.cash.balance, recent: recent.map(entry=>displayNames(entry,masters,balances)) };
}

async function dashboardData(workspaceId: string, asOf: Date, masters: Record<string, PublicEntry[]>, filters: QueryFilters) {
  const to = asOf.toISOString().slice(0, 10), stockMonth = fieldValue(filters, "stock_month", to.slice(0, 7));
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(stockMonth)) throw new PetrosoftError("Choose a valid stock month.");
  const monthEnd = new Date(Date.UTC(Number(stockMonth.slice(0, 4)), Number(stockMonth.slice(5, 7)), 0));
  const stockTo = monthEnd > asOf ? asOf : monthEnd;
  const [history, banks, stockHistory, dashboardStock] = await Promise.all([
    transactionRecords(workspaceId, ["meter-sales", "credit-sales", "recoveries", "swipes", "expenses", "lubricant-sales", "bowser-sales", "bowser-credit-sales", "bowser-recoveries", "bowser-swipes", "bowser-expenses", "bowser-lubricant-sales", "fuel-purchases", "lubricant-purchases"], { from: "1900-01-01", to }, false),
    petrosoftDb.petrosoftLedger.groupBy({ by: ["entityId"], where: { entityType: "bank", date: asOf, entry: { workspaceId, status: { not: "void" } } }, _sum: { debit: true, credit: true } }),
    stockTo.toISOString().slice(0, 7) === stockMonth ? transactionRecords(workspaceId, ["opening-stock"], { from: `${stockMonth}-01`, to: stockTo.toISOString().slice(0, 10) }, false) : Promise.resolve([]),
    tankStock(workspaceId, stockTo, masters),
  ]);
  const product = fieldValue(filters, "dashboard_product", (masters["fuel-products"] || []).find(entry => entry.status === "active")?.externalId || "");
  const lubricant = product.startsWith("l_"), productId = lubricant ? product.slice(2) : product;
  const monthly = new Map<string, PetrosoftFields>();
  for (const entry of history) {
    const isSale = baseModule(entry.module) === (lubricant ? "lubricant-sales" : "meter-sales"), isPurchase = entry.module === (lubricant ? "lubricant-purchases" : "fuel-purchases");
    if (!isSale && !isPurchase) continue;
    const f = entry.fields, items = isPurchase && Array.isArray(f.items) ? f.items.map(jsonFields) : [{ ...f, quantity: entry.quantity }];
    const amount = items.filter(item => !productId || fieldValue(item, PRODUCT_KEYS) === productId).reduce((total, item) => total.add(fieldValue(item, ["quantity", "pro_qty", "pur_proqty"], entry.quantity)).sub(entry.module === "bowser-sales" ? fieldValue(item, "receipt", "0") : 0), quantity(0));
    if (amount.isZero()) continue;
    const date = `${entry.date.slice(0, 7)}-01`, row = monthly.get(date) || { date, sale: "0", purchase: "0" }, key = isSale ? "sale" : "purchase";
    row[key] = quantity(row[key]).add(amount).toString(); monthly.set(date, row);
  }
  const aggregateMonths = (rows: PublicEntry[]) => {
    const groups = new Map<string, PetrosoftFields>();
    for (const daily of dailySummary(rows)) {
      const date = `${daily.date.slice(0, 7)}-01`, row = groups.get(date) || { date };
      for (const [key, offered] of Object.entries(daily)) if (key !== "date") row[key] = money(row[key] || 0).add(offered || 0).toString();
      groups.set(date, row);
    }
    return [...groups.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  };
  const customer = fieldValue(filters, "credit_customer");
  const recoveryHistory = history.filter(entry => ["credit-sales", "recoveries"].includes(baseModule(entry.module)) || baseModule(entry.module) === "lubricant-sales" && /credit/i.test(fieldValue(entry.fields, ["sale_type1", "sale_type"]))).filter(entry => !customer || customer === "0" || fieldValue(entry.fields, CUSTOMER_KEYS) === customer);
  return {
    dashboardProduct: product, stockMonth, dashboardStock,
    trends: aggregateMonths(history), monthlyTrends: [...monthly.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))), recoveryTrends: aggregateMonths(recoveryHistory),
    stockTrends: stockHistory.sort((a, b) => a.date.localeCompare(b.date)),
    bankFlow: banks.map(bank => ({ id: bank.entityId, name: (masters["business-parties"] || []).find(party => party.externalId === bank.entityId)?.name || bank.entityId, debit: money(bank._sum.debit || 0).toString(), credit: money(bank._sum.credit || 0).toString() })),
  };
}

export async function entryForActor(actor: PetrosoftActor, id: string) {
  const entry = await petrosoftDb.petrosoftEntry.findFirst({ where: { id, workspaceId: actor.workspaceId, status: { not: "void" } } });
  if (!entry) throw new PetrosoftError("Entry not found.", 404);
  if (!hasPermission(actor, entry.module)) throw new PetrosoftError("Your role cannot view this entry.", 403);
  return serializeEntry(entry);
}

export { Prisma };
