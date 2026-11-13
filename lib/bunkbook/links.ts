import { Prisma, type BunkBookEntry } from "@prisma/client";
import { fieldValue, jsonFields, type BunkBookFields } from "./catalog";
import { baseModule, money, quantity, safeFields, type LedgerPosting, type NormalizedRow } from "./rules";

type Database = Prisma.TransactionClient;
type Save = (module: string, row: NormalizedRow, posts?: LedgerPosting[], id?: string) => Promise<BunkBookEntry>;
const vendorSources: Record<string, string[]> = {
  LIQUIDS: ["fuel-purchases", "other-purchases", "lfr-invoices"], LUBS: ["lubricant-purchases"],
  Recovery: ["recoveries", "bowser-recoveries"], Swipe: ["swipe-settlements"], Expenses: ["expenses", "bowser-expenses"],
};

export async function sourceParent(database: Database, entry: BunkBookEntry) {
  const f = jsonFields(entry.fields);
  const parentId = fieldValue(f, "parent_id");
  if (parentId) return database.bunkBookEntry.findFirst({ where: { id: parentId, status: { not: "void" } } });
  if (entry.module === "vendor-transactions" && f._native) {
    const modules = vendorSources[fieldValue(f, "invoice_of")];
    if (modules) return database.bunkBookEntry.findFirst({ where: { module: { in: modules }, externalId: fieldValue(f, "purchase_id"), status: { not: "void" } } });
  }
  if (entry.module === "business-transactions" && fieldValue(f, "trans_frmModule") === "VENDOR") {
    return database.bunkBookEntry.findFirst({ where: { module: "vendor-transactions", externalId: fieldValue(f, "trans_frmModule_Id"), status: { not: "void" } } });
  }
  return null;
}

export async function linkedEntries(database: Database, entry: BunkBookEntry) {
  const fields = jsonFields(entry.fields), nativeId = entry.externalId || String(entry.number), clauses: Prisma.BunkBookEntryWhereInput[] = [{ fields: { path: ["parent_id"], equals: entry.id } }];
  const vendorSource = Object.entries(vendorSources).find(([, modules]) => modules.includes(entry.module))?.[0];
  if (fields._native && vendorSource) clauses.push({ module: "vendor-transactions", AND: [{ fields: { path: ["invoice_of"], equals: vendorSource } }, { fields: { path: ["purchase_id"], equals: nativeId } }] });
  if (fields._native && entry.module === "vendor-transactions") clauses.push({ module: "business-transactions", AND: [{ fields: { path: ["trans_frmModule"], equals: "VENDOR" } }, { fields: { path: ["trans_frmModule_Id"], equals: nativeId } }] });
  if (fields._native && ["vendors", "business-parties"].includes(entry.module) && fieldValue(fields, "openmodule_id") !== "0") {
    clauses.push({ module: entry.module === "vendors" ? "vendor-transactions" : "business-transactions", externalId: fieldValue(fields, "openmodule_id", "missing") });
  }
  if (entry.module === "attendance") clauses.push({ module: "attendance-details", fields: { path: ["attend_id"], equals: nativeId } });
  if (entry.module === "payroll") clauses.push({ module: "payroll-details", fields: { path: ["payroll_id"], equals: entry.id } });
  return database.bunkBookEntry.findMany({ where: { id: { not: entry.id }, status: { not: "void" }, OR: clauses } });
}

export async function removeLinkedEntries(database: Database, entry: BunkBookEntry, financialOnly = false) {
  const children = (await linkedEntries(database, entry)).filter(child => !financialOnly || ["vendor-transactions", "business-transactions"].includes(child.module));
  for (const child of children) {
    await removeLinkedEntries(database, child, financialOnly);
    await database.bunkBookLedger.deleteMany({ where: { entryId: child.id } });
    await database.bunkBookEntry.update({ where: { id: child.id }, data: { status: "void" } });
  }
  return children;
}

export async function synchronizeFinancialLinks(_database: Database, entry: BunkBookEntry, posts: LedgerPosting[], save: Save) {
  const f = jsonFields(entry.fields);
  if (f.derived || f.parent_id || ["attendance-details", "payroll-details"].includes(entry.module)) return;
  const id = entry.externalId || String(entry.number);
  for (const post of posts) {
    const type = post.entityType;
    if (!["bank", "party", "vendor"].includes(type)) continue;
    if (entry.module === "vendor-transactions" && type === "vendor") continue;
    if (entry.module === "business-transactions" && type !== "vendor") continue;
    const debit = money(post.debit || 0), credit = money(post.credit || 0), amount = debit.add(credit);
    if (amount.isZero()) continue;
    const entityId = post.entityId === "__SELF__" ? id : post.entityId;
    const isVendor = type === "vendor", moduleSchema = isVendor ? "vendor-transactions" : "business-transactions";
    const fields: BunkBookFields = { derived: true, parent_id: entry.id, parent_module: entry.module, parent_external_id: id, trans_dt: entry.date.toISOString().slice(0, 10), trans_type: debit.gt(0) ? "Debit" : "Credit", trans_amnt: amount.toString(),
      account_type: type, account_id: entityId, trans_desc: fieldValue(f, ["trans_desc", "descript", "description", "rec_desc", "hand_des"], entry.name), source_module: baseModule(entry.module), invoice_no: fieldValue(f, ["invo_no", "invoiceno", "invoice", "bill_no", "credit_billno"]),
      ...(isVendor ? { vendor: entityId, vendor_id: entityId, Vendor: entityId, invoice_of: entry.module } : { crd_id: entityId, partyname_field: entityId, partytype: debit.gt(0) ? entityId : "", Topartytype: credit.gt(0) ? entityId : "" }) };
    await save(moduleSchema, { name: entry.name, date: entry.date, fields, amount, quantity: quantity(0), rate: quantity(0), status: "active" }, []);
  }
}

export async function attachNativeLinks(database: Database) {
  const all = await database.bunkBookEntry.findMany({ where: { status: { not: "void" } } });
  const byModule = new Map(all.map(entry => [`${entry.module}:${entry.externalId}`, entry]));
  let count = 0;
  for (const entry of all.filter(entry => ["vendor-transactions", "business-transactions"].includes(entry.module))) {
    const fields = jsonFields(entry.fields);
    if (!fields._native || fields.parent_id) continue;
    let parent: BunkBookEntry | undefined;
    if (entry.module === "vendor-transactions") {
      for (const moduleSchema of vendorSources[fieldValue(fields, "invoice_of")] || []) parent ||= byModule.get(`${moduleSchema}:${fieldValue(fields, "purchase_id")}`);
    } else if (fieldValue(fields, "trans_frmModule") === "VENDOR") parent = byModule.get(`vendor-transactions:${fieldValue(fields, "trans_frmModule_Id")}`);
    if (!parent) continue;
    await database.bunkBookEntry.update({ where: { id: entry.id }, data: { fields: safeFields({ ...fields, parent_id: parent.id, parent_module: parent.module, derived: true }) } });
    count++;
  }
  return count;
}
