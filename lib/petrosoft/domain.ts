import { Prisma, type PetrosoftEntry } from "@prisma/client";
import type { PetrosoftActor } from "./auth";
import { dateValue, fieldNumber, fieldValue, jsonFields, moduleById, type PetrosoftFields, today } from "./catalog";
import { money, positive, quantity, safeFields, type LedgerPosting, type NormalizedRow } from "./rules";

import { payrollPreview, savePayroll } from "./payroll";
import { interestAction } from "./interest";
export { payrollPreview } from "./payroll";

type Database = Prisma.TransactionClient;
type Save = (module: string, row: NormalizedRow, posts?: LedgerPosting[], id?: string) => Promise<PetrosoftEntry>;
const emptyRow = (name: string, date: Date, fields: PetrosoftFields, amount: unknown = 0): NormalizedRow => ({ name, date, fields, amount: money(amount), quantity: quantity(0), rate: quantity(0), status: "active" });
const values = (fields: PetrosoftFields, name: string): unknown[] => Array.isArray(fields[`${name}[]`]) ? fields[`${name}[]`] as unknown[] : fields[name] === undefined ? [] : Array.isArray(fields[name]) ? fields[name] as unknown[] : [fields[name]];
const identity = (entry: PetrosoftEntry) => entry.externalId || String(entry.number);

async function requireMaster(database: Database, actor: PetrosoftActor, module: string, id: unknown) {
  const text = String(id || "").split("|")[0];
  const entry = await database.petrosoftEntry.findFirst({ where: { workspaceId: actor.workspaceId, module, status: { not: "void" }, OR: [{ id: text }, { externalId: text }] } });
  if (!entry) throw new Error(`Choose a valid ${module.replace(/-/g, " ")} entry for this station.`);
  return entry;
}

export async function domainAction(database: Database, actor: PetrosoftActor, module: string, operation: string, fields: PetrosoftFields, id: string | undefined, save: Save): Promise<unknown | undefined> {
  if (module === "interest" && ["save", "preview-loan"].includes(operation)) return interestAction(database, actor, operation, fields, id, save);
  if (module === "attendance" && operation === "save") {
    const date = dateValue(fieldValue(fields, ["insert_date", "date", "date_attend"]));
    const shift = fieldValue(fields, "shift", "S-1");
    const rows = Array.isArray(fields.rows) ? fields.rows.map(jsonFields) : values(fields, "employee").map((employee, index) => ({ employee, attend_type: values(fields, "attend_type")[index] || "P", attend_remark: values(fields, "attend_remark")[index] || "Paid", hours: values(fields, "hours")[index] || "8" }));
    if (!rows.length) throw new Error("Choose employees and attendance statuses.");
    const seen = new Set<string>();
    for (const row of rows) { const employee = await requireMaster(database, actor, "employees", row.employee); const code = identity(employee); if (seen.has(code)) throw new Error("An employee can appear only once in an attendance sheet."); seen.add(code); row.employee = code; if (!["P", "A", "P:A", "H"].includes(fieldValue(row, "attend_type"))) throw new Error("Choose a valid attendance status."); }
    const duplicate = await database.petrosoftEntry.findFirst({ where: { workspaceId: actor.workspaceId, module, date, status: { not: "void" }, fields: { path: ["shift"], equals: shift }, ...(id ? { id: { not: id } } : {}) } });
    if (duplicate) throw new Error("Attendance already exists for this date and shift. Edit the existing sheet.");
    const parent = await save(module, emptyRow("Attendance", date, { ...fields, rows: undefined, shift, presents: rows.filter(row => fieldValue(row, "attend_type").startsWith("P")).length, absents: rows.filter(row => fieldValue(row, "attend_type") === "A").length }), [], id);
    if (id) {
      const children = await database.petrosoftEntry.findMany({ where: { workspaceId: actor.workspaceId, module: "attendance-details", fields: { path: ["attend_id"], equals: identity(parent) } } });
      if (children.length) await database.petrosoftEntry.updateMany({ where: { id: { in: children.map(child => child.id) } }, data: { status: "void" } });
    }
    for (const row of rows) await save("attendance-details", emptyRow("Attendance", date, { ...row, shift, attend_id: identity(parent), hours: positive(fieldValue(row, "hours", "0"), "Attendance hours", true).toString() }), []);
    return { message: "Attendance saved.", id: parent.id };
  }
  if (module === "payroll" && ["preview-payroll", "save", "pay"].includes(operation)) {
    return operation === "preview-payroll" ? payrollPreview(database, actor, fields) : savePayroll(database, actor, operation, fields, id, save);
  }
  if (module === "expiry-items" && !fieldValue(fields, "item_name") && values(fields, "cat_name").length) {
    for (const name of values(fields, "cat_name")) if (String(name).trim()) await save("expiry-categories", emptyRow(String(name).trim(), today(), { cat_name: String(name).trim() }), []);
    return { message: "Expiry categories saved." };
  }
  if (module === "expiry-items" && values(fields, "item_name").length) {
    const date = dateValue(fieldValue(fields, "insert_date"));
    for (const [index, name] of values(fields, "item_name").entries()) {
      const category = await requireMaster(database, actor, "expiry-categories", values(fields, "cat_name")[index]);
      const item = await save("expiry-items", emptyRow(String(name), date, { item_name: name, cat_id: identity(category) }), [], id);
      const expiry = dateValue(values(fields, "exp_date")[index]);
      await save("expiry-renewals", emptyRow(String(values(fields, "item_no")[index] || name), date, { item_id: identity(item), cat_id: identity(category), item_number: values(fields, "item_no")[index], exp_date: expiry.toISOString().slice(0, 10), alert_days: values(fields, "alert_days")[index] || "0", descp: values(fields, "note")[index] || "" }), []);
    }
    return { message: "Expiry items registered." };
  }
  if (module === "loyalty-points" && fields.start_qty !== undefined) {
    const start = positive(fields.start_qty, "Starting quantity", true);
    await database.petrosoftWorkspace.update({ where: { id: actor.workspaceId }, data: { settings: safeFields({ ...jsonFields(actor.workspace.settings), ponits_start: start.toString(), start_qty: start.toString(), ponits: "1" }) } });
    return { message: "Loyalty points configuration saved." };
  }
  if (module === "employee-benefits") {
    const employee = await requireMaster(database, actor, "employees", fields.employee);
    const before = jsonFields(employee.fields), updates: PetrosoftFields = {};
    for (const key of ["pf", "esi", "it", "salary"]) if (fields[key] !== undefined) updates[key] = positive(fields[key], key, true).toString();
    if (Object.keys(updates).length) await database.petrosoftEntry.update({ where: { id: employee.id }, data: { fields: safeFields({ ...before, ...updates }) } });
    const amounts = values(fields, "earn_amt"), names = values(fields, "earning"), existing = await database.petrosoftEntry.findMany({ where: { workspaceId: actor.workspaceId, module, status: { not: "void" }, fields: { path: ["employee"], equals: identity(employee) } } });
    const kept = new Set<string>();
    if (names.length) for (const [index, offered] of names.entries()) {
      const name = String(offered).trim(); if (!name) continue;
      const previous = existing.find(entry => entry.name.toLowerCase() === name.toLowerCase() && !kept.has(entry.id));
      const entry = await save(module, emptyRow(name, today(), { employee: identity(employee), earn_type: name }, positive(amounts[index], "Earning amount", true)), [], previous?.id || id);
      kept.add(entry.id);
    }
    const removed = existing.filter(entry => !kept.has(entry.id));
    if (names.length && removed.length) await database.petrosoftEntry.updateMany({ where: { id: { in: removed.map(entry => entry.id) } }, data: { status: "void" } });
    return { message: "Employee earnings and deductions saved." };
  }
  if (module === "assignment-returns") {
    const parent = await database.petrosoftEntry.findFirst({ where: { id: fieldValue(fields, "assignment_id"), workspaceId: actor.workspaceId, module: "day-assignments", status: { not: "void" } } });
    if (!parent) throw new Error("Choose an assignment from this station.");
    const f = jsonFields(parent.fields), assigned = quantity(fieldValue(f, ["qunt", "quantity"], parent.quantity.toString())), sold = positive(fieldValue(fields, "sold_qty", "0"), "Sold quantity", true), returned = positive(fieldValue(fields, "returned_qty", "0"), "Returned quantity", true);
    if (sold.add(returned).gt(assigned)) throw new Error("Sold and returned quantities cannot exceed the assignment.");
    const balance = quantity(assigned.sub(sold).sub(returned));
    await database.petrosoftEntry.update({ where: { id: parent.id }, data: { fields: safeFields({ ...f, sold_qty: sold.toString(), returned_qty: returned.toString(), balance: balance.toString(), closed: balance.isZero() }) } });
    await save(module, emptyRow("Assignment Recovery", dateValue(fieldValue(fields, ["date", "recv_date"], today().toISOString().slice(0, 10))), { ...fields, balance: balance.toString() }), []);
    return { message: "Assignment recovery saved." };
  }
  if (module === "customer-interest") {
    const customer = await requireMaster(database, actor, "customers", fields.customer_id);
    const rate = positive(fieldValue(fields, ["interest", "int_percent"], "0"), "Interest percentage", true);
    await database.petrosoftEntry.update({ where: { id: customer.id }, data: { fields: safeFields({ ...jsonFields(customer.fields), int_type: fieldValue(fields, "int_type", "Fixed"), int_run: fieldValue(fields, "int_run", "Year"), grace_days: fieldNumber(fields, "grace_days"), int_percent: rate.toString() }) } });
    await save(module, emptyRow(customer.name, today(), { ...fields, interest: rate.toString() }), [], id);
    return { message: "Customer interest settings saved." };
  }
  if (module === "opening-stock" && operation === "save") {
    const rows = Array.isArray(fields.rows) ? fields.rows.map(jsonFields) : [fields];
    const date = dateValue(fieldValue(fields, ["insert_date", "date", "_date"]));
    const entries = [];
    for (const item of rows) {
      const tankNo = fieldValue(item, ["tank_no", "stock_tank"]);
      const tank = await database.petrosoftEntry.findFirst({ where: { workspaceId: actor.workspaceId, module: "tanks", status: { not: "void" }, fields: { path: ["tank_no"], equals: tankNo } } });
      if (!tank) throw new Error("Choose a valid tank for this station.");
      const open = positive(fieldValue(item, ["open_stock", "opening_stock"], "0"), "Opening stock", true), receipts = positive(fieldValue(item, "receipt", "0"), "Receipt", true), sale = positive(fieldValue(item, "meter_sale", "0"), "Meter sale", true);
      const closing = quantity(open.add(receipts).sub(sale));
      if (closing.lt(0)) throw new Error("Meter sale cannot exceed the tank's available stock.");
      const dip = positive(fieldValue(item, "dip_stock", closing.toString()), "Dip stock", true);
      const duplicate = await database.petrosoftEntry.findFirst({ where: { workspaceId: actor.workspaceId, module, date, status: { not: "void" }, fields: { path: ["tank_no"], equals: tankNo }, ...(id ? { id: { not: id } } : {}) } });
      if (duplicate) throw new Error("A stock entry already exists for this tank and date. Edit that entry.");
      const product = fieldValue(jsonFields(tank.fields), ["product", "pro_name"]);
      const entry = await save(module, { ...emptyRow(tank.name, date, { ...item, tank_no: tankNo, product, open_stock: open.toString(), receipt: receipts.toString(), total_stk: open.add(receipts).toString(), meter_sale: sale.toString(), close_stock: closing.toString(), dip_stock: dip.toString(), stk_variation: dip.sub(closing).toString() }), quantity: open }, [], id);
      entries.push(entry.id);
    }
    return { message: "Day opening stock saved.", entries };
  }
  return undefined;
}

export async function synchronizeMasterChildren(database: Database, actor: PetrosoftActor, entry: PetrosoftEntry, fields: PetrosoftFields, save: Save) {
  const id = identity(entry);
  if (entry.module === "customers" || entry.module === "guests") {
    const names = values(fields, "vehicle_no");
    for (const [index, name] of names.entries()) {
      if (!String(name).trim()) continue;
      const existing = await database.petrosoftEntry.findFirst({ where: { workspaceId: actor.workspaceId, module: "vehicles", name: String(name), status: { not: "void" }, fields: { path: [entry.module === "customers" ? "customer_id" : "guest_id"], equals: id } } });
      if (!existing) await save("vehicles", emptyRow(String(name).toUpperCase(), entry.date, { vehicle_no: String(name).toUpperCase(), customer_id: entry.module === "customers" ? id : "", guest_id: entry.module === "guests" ? id : "", vehicle_place: values(fields, "vehicle_place")[index] || "", vehicle_type: values(fields, "vehicle_type")[index] || "" }), []);
    }
    for (const [index, product] of values(fields, "pd_prod_id").entries()) {
      if (!product) continue;
      await requireMaster(database, actor, "fuel-products", product);
      const existing = await database.petrosoftEntry.findFirst({ where: { workspaceId: actor.workspaceId, module: "customer-discounts", status: { not: "void" }, AND: [{ fields: { path: ["customer_id"], equals: id } }, { fields: { path: ["product"], equals: String(product) } }] } });
      await save("customer-discounts", emptyRow(String(product), entry.date, { customer_id: id, product, disc_offer: values(fields, "pd_disc_offer")[index] || "0", offer_type: values(fields, "pd_offer_type")[index] || "Qty" }), [], existing?.id);
    }
  }
  if (entry.module === "tanks") {
    for (const name of values(fields, "nozzel")) if (String(name).trim()) await save("nozzles", emptyRow(String(name), entry.date, { nozzle_name: name, noz_name: name, tank_no: fieldValue(jsonFields(entry.fields), "tank_no", `T${entry.number}`), product: fieldValue(fields, ["pro_name", "product"]) }), []);
  }
  if (entry.module === "employees") {
    const names = fields.earning ?? fields["earning[]"];
    const amounts = fields.earn_amt ?? fields["earn_amt[]"];
    if (Array.isArray(names) && Array.isArray(amounts)) for (const [index, name] of names.entries()) if (String(name).trim()) await save("employee-benefits", emptyRow(String(name), entry.date, { employee: id, earn_type: name }, amounts[index] || 0), []);
  }
}

export async function adjustStockSnapshots(database: Database, workspaceId: string, date: Date, before: LedgerPosting[], after: LedgerPosting[]) {
  const changes = new Map<string, { receipt: Prisma.Decimal; sale: Prisma.Decimal }>();
  for (const [posts, sign] of [[before, -1], [after, 1]] as const) for (const post of posts) if (post.entityType === "tank") {
    const movement = quantity(post.quantity || 0), value = changes.get(post.entityId) || { receipt: quantity(0), sale: quantity(0) };
    if (movement.gt(0)) value.receipt = value.receipt.add(movement.mul(sign)); else value.sale = value.sale.sub(movement.mul(sign));
    changes.set(post.entityId, value);
  }
  for (const [tank, deltas] of changes) {
    const change = deltas.receipt.sub(deltas.sale);
    if (deltas.receipt.isZero() && deltas.sale.isZero()) continue;
    const snapshots = await database.petrosoftEntry.findMany({ where: { workspaceId, module: "opening-stock", date: { gte: date }, status: { not: "void" }, fields: { path: ["tank_no"], equals: tank } } });
    for (const snapshot of snapshots) {
      const f = jsonFields(snapshot.fields), sameDay = snapshot.date.getTime() === date.getTime();
      const opening = quantity(fieldValue(f, "open_stock", "0")).add(sameDay ? 0 : change), close = quantity(fieldValue(f, "close_stock", "0")).add(change);
      const receipts = quantity(fieldValue(f, "receipt", "0")).add(sameDay ? deltas.receipt : 0), sales = quantity(fieldValue(f, "meter_sale", "0")).add(sameDay ? deltas.sale : 0);
      const fields = { ...f, open_stock: opening.toString(), close_stock: close.toString(), total_stk: opening.add(receipts).toString(), receipt: receipts.toString(), meter_sale: sales.toString(), stk_variation: quantity(fieldValue(f, "dip_stock", "0")).sub(close).toString() };
      await database.petrosoftEntry.update({ where: { id: snapshot.id }, data: { quantity: opening, fields: safeFields(fields) } });
    }
  }
}

export { moduleById };
