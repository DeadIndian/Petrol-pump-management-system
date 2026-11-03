import { Prisma, type PetrosoftEntry } from "@prisma/client";
import type { PetrosoftActor } from "./auth";
import { dateValue, fieldValue, jsonFields, type PetrosoftFields } from "./catalog";
import { CUSTOMER_KEYS, money, quantity, safeFields, type NormalizedRow } from "./rules";
import type { ReportResult, ReportRow } from "./report-data";

type Database = Prisma.TransactionClient;
type Save = (module: string, row: NormalizedRow, posts?: [], id?: string) => Promise<PetrosoftEntry>;
const row = (name: string, date: Date, fields: PetrosoftFields, amount: unknown): NormalizedRow => ({ name, date, fields, amount: money(amount), quantity: quantity(0), rate: quantity(0), status: "active" });
const identity = (entry: PetrosoftEntry) => entry.externalId || String(entry.number);
const serializable = (entry: PetrosoftEntry): PetrosoftFields => ({ id: entry.id, number: entry.number, module: entry.module, name: entry.name, date: entry.date.toISOString().slice(0, 10), amount: entry.amount.toString(), quantity: entry.quantity.toString(), price: entry.rate.toString(), ...safeFields(jsonFields(entry.fields)) });
async function balance(database: Database, actor: PetrosoftActor, type: string, id: string, before: Date) {
  const total = await database.petrosoftLedger.aggregate({ where: { entityType: type, entityId: id, date: { lt: before }, entry: { workspaceId: actor.workspaceId, status: { not: "void" } } }, _sum: { debit: true, credit: true } });
  return money(total._sum.debit || 0).sub(total._sum.credit || 0);
}
export async function generateDocuments(database: Database, actor: PetrosoftActor, module: string, fields: PetrosoftFields, ids: string[], save: Save) {
  if (module === "sale-invoices") {
    if (!ids.length) throw new Error("Select sale transactions to include in the invoice.");
    const selected = await database.petrosoftEntry.findMany({ where: { id: { in: ids }, workspaceId: actor.workspaceId, module: { in: ["credit-sales", "lubricant-sales", "guest-sales"] }, status: { not: "void" } }, orderBy: [{ date: "asc" }, { number: "asc" }] });
    if (selected.length !== ids.length) throw new Error("One or more selected sales are unavailable.");
    if (selected.some(entry => fieldValue(jsonFields(entry.fields), "invoice_id"))) throw new Error("A selected sale already belongs to an invoice. Open Generated Invoices.");
    const groups = new Map<string, PetrosoftEntry[]>();
    for (const entry of selected) { const customer = fieldValue(jsonFields(entry.fields), CUSTOMER_KEYS, "cash"); (groups.get(customer) || (groups.set(customer, []), groups.get(customer)!)).push(entry); }
    const documents = [];
    for (const [customer, entries] of groups) {
      const party = await database.petrosoftEntry.findFirst({ where: { workspaceId: actor.workspaceId, module: "customers", externalId: customer } });
      const total = entries.reduce((sum, entry) => sum.add(entry.amount), money(0));
      const document = await save("generated-invoices", row(party?.name || "Cash", dateValue(fieldValue(fields, ["invoice_date", "date"], entries.at(-1)!.date.toISOString().slice(0, 10))), { ...fields, customer_id: customer, organization_name: party?.name || "Cash", party_type: customer === "cash" ? "Cash" : "Credit", customer: party ? serializable(party) : {}, items: entries.map(serializable), total_amount: total.toString(), source_ids: entries.map(entry => entry.id), provider_status: "draft" }, total));
      for (const entry of entries) await database.petrosoftEntry.update({ where: { id: entry.id }, data: { fields: safeFields({ ...jsonFields(entry.fields), invoice_id: document.id, invoice_number: `${fieldValue(jsonFields(actor.workspace.settings), "billno_prefix")}${document.number}` }) } });
      documents.push({ id: document.id, number: document.number });
    }
    return { message: `${documents.length} invoice${documents.length === 1 ? "" : "s"} generated.`, documents };
  }
  if (module === "statements") {
    const from = dateValue(fieldValue(fields, ["frm_dt", "from"])), to = dateValue(fieldValue(fields, ["to_dt", "to"]));
    if (from > to) throw new Error("The from date must be on or before the to date.");
    const customerId = fieldValue(fields, "credit_org"), category = fieldValue(fields, "credit_category"), vehicle = fieldValue(fields, "vehi_no");
    const customers = (await database.petrosoftEntry.findMany({ where: { workspaceId: actor.workspaceId, module: "customers", status: { not: "void" }, ...(customerId && !/all/i.test(customerId) ? { externalId: customerId } : {}) }, orderBy: { name: "asc" } })).filter(customer => !category || /all/i.test(category) || fieldValue(jsonFields(customer.fields), ["cust_category", "category"]) === category);
    if (!customers.length) throw new Error("Choose a customer to generate a statement.");
    const documents = [];
    for (const customer of customers) {
      const opening = await balance(database, actor, "customer", identity(customer), from);
      const posts = await database.petrosoftLedger.findMany({ where: { entityType: "customer", entityId: identity(customer), date: { gte: from, lte: to }, entry: { workspaceId: actor.workspaceId, status: { not: "void" } } }, include: { entry: true }, orderBy: [{ date: "asc" }, { id: "asc" }] });
      let running = opening, debit = money(0), credit = money(0);
      const items = posts.filter(post => !vehicle || fieldValue(jsonFields(post.entry.fields), ["vehi_no", "vehicle_no", "lubvehi_no"]) === vehicle).map(post => { running = running.add(post.debit).sub(post.credit); debit = debit.add(post.debit); credit = credit.add(post.credit); return { ...serializable(post.entry), collectable: post.debit.toString(), payment: post.credit.toString(), balance: running.toString() }; });
      const statement = await save("statement-records", row(customer.name, to, { customer_id: identity(customer), organization_name: customer.name, customer: serializable(customer), frm_dt: from.toISOString().slice(0, 10), to_dt: to.toISOString().slice(0, 10), vehi_no: vehicle, opening_balance: opening.toString(), debit: debit.toString(), credit: credit.toString(), closing_balance: running.toString(), bill_amt: debit.toString(), items, terms: fieldValue(jsonFields(actor.workspace.settings), ["st_terms", "statement_terms"]) }, running));
      documents.push({ id: statement.id, number: statement.number });
    }
    return { message: `${documents.length} statement${documents.length === 1 ? "" : "s"} generated.`, documents };
  }
  if (["brs-generation", "vrs-generation"].includes(module)) {
    const from = dateValue(fieldValue(fields, ["frm_dt", "from"])), to = dateValue(fieldValue(fields, ["to_dt", "to"]));
    if (from > to) throw new Error("The from date must be on or before the to date.");
    const vendor = module === "vrs-generation", selected = fieldValue(fields, ["credit_org", "party_id"]), type = vendor ? "vendor" : "bank";
    const party = await database.petrosoftEntry.findFirst({ where: { workspaceId: actor.workspaceId, module: vendor ? "vendors" : "business-parties", externalId: selected, status: { not: "void" } } });
    if (!party) throw new Error(`Choose a valid ${vendor ? "vendor" : "bank"}.`);
    const opening = await balance(database, actor, type, selected, from);
    const posts = await database.petrosoftLedger.findMany({ where: { entityType: type, entityId: selected, date: { gte: from, lte: to }, entry: { workspaceId: actor.workspaceId, status: { not: "void" } } }, include: { entry: true }, orderBy: [{ date: "asc" }, { id: "asc" }] });
    let running = opening;
    const items: PetrosoftFields[] = posts.map(post => { running = running.add(post.debit).sub(post.credit); return { ...serializable(post.entry), debit: post.debit.toString(), credit: post.credit.toString(), balance: running.toString(), reconciled: Boolean(jsonFields(post.entry.fields).reconciled) }; });
    const adjustments = await database.petrosoftEntry.findMany({ where: { workspaceId: actor.workspaceId, module: vendor ? "vrs" : "brs", date: { lte: to }, status: { not: "void" } } });
    let adjustment = money(0);
    for (const entry of adjustments) { const f = jsonFields(entry.fields); if (fieldValue(f, ["partytype", "party_id"]).split("|")[0] !== selected || f.reconciled) continue; adjustment = /add|debit/i.test(fieldValue(f, ["type", "head"])) ? adjustment.add(entry.amount) : adjustment.sub(entry.amount); items.push({ ...serializable(entry), debit: /add|debit/i.test(fieldValue(f, ["type", "head"])) ? entry.amount.toString() : "0", credit: /add|debit/i.test(fieldValue(f, ["type", "head"])) ? "0" : entry.amount.toString(), statement_adjustment: true }); }
    const document = await save(vendor ? "vrs-statements" : "brs-statements", row(party.name, to, { party_id: selected, customer_id: selected, frm_dt: from.toISOString().slice(0, 10), to_dt: to.toISOString().slice(0, 10), opening_balance: opening.toString(), book_balance: running.toString(), adjustment: adjustment.toString(), closing_balance: running.add(adjustment).toString(), items }, running.add(adjustment)));
    return { message: "Reconciliation statement generated.", documents: [{ id: document.id, number: document.number }] };
  }
  return undefined;
}

export function documentReport(entry: PetrosoftEntry): ReportResult {
  const fields = jsonFields(entry.fields), items = Array.isArray(fields.items) ? fields.items.map(jsonFields) : [];
  const statement = ["statement-records", "brs-statements", "vrs-statements"].includes(entry.module);
  const rows: ReportRow[] = items.map(item => ({ ...item, product: fieldValue(item, ["product_name", "product"]), customer: fieldValue(item, "organization_name"), employee: fieldValue(item, "employee_name"), vehicle: fieldValue(item, ["vehi_no", "vehicle_no", "lubvehi_no"]), refno: fieldValue(item, ["credit_billno", "billno", "number"]), quantity: fieldValue(item, ["quantity", "qnty"]), amount: fieldValue(item, "cost", fieldValue(item, "amount")), total: fieldValue(item, "amount"), discount: fieldValue(item, ["discount", "credit_discnt"], "0"), misccharges: fieldValue(item, ["misc_charges", "batta_amt"], "0"), description: fieldValue(item, ["description", "desc", "rec_desc", "trans_desc"]) }));
  const title = `${statement ? "Statement" : "Tax Invoice"} ${String(entry.number).padStart(6, "0")} — ${entry.name}`;
  if (statement) rows.unshift({ date: fieldValue(fields, "frm_dt"), description: "Opening Balance", balance: fieldValue(fields, "opening_balance", "0") });
  return { title, from: fieldValue(fields, "frm_dt", entry.date.toISOString().slice(0, 10)), to: fieldValue(fields, "to_dt", entry.date.toISOString().slice(0, 10)), format: "html", sections: [{ title: entry.name, columns: statement ? ["S.No", "Date", "Ref No", "Vehicle No", "Product", "Price", "Qty", "Total", "Collectable", "Payment", "Balance", "Description"] : ["S.No", "Date", "Vehicle No", "Product", "Quantity", "Price", "Amount", "Discount", "Misc.Charges", "Total"], rows }, { title: "Summary", columns: ["Description", "Amount"], rows: [{ description: statement ? "Closing Balance" : "Invoice Total", amount: fieldValue(fields, "closing_balance", entry.amount.toString()) }, ...(fieldValue(fields, "terms") ? [{ description: fieldValue(fields, "terms"), amount: "" }] : [])] }] };
}
