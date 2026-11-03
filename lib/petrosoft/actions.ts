import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { hasPermission, hashPassword, verifyPassword, type PetrosoftActor } from "./auth";
import { dateValue, fieldNumber, fieldValue, formFor, jsonFields, moduleById, type ModuleSchema, type PetrosoftFields, today } from "./catalog";
import { petrosoftDb } from "./db";
import { adjustStockSnapshots, domainAction, synchronizeMasterChildren } from "./domain";
import { generateDocuments } from "./documents";
import { adjustCashSnapshots, cashAt, cashMovement } from "./cash";
import { removeLinkedEntries, sourceParent, synchronizeFinancialLinks } from "./links";
import { hasMasterReferences, validateMasterReferences } from "./masters";
import { permissionsForPages, pagesForPermissions, rolePages } from "./permissions";
import { earnedPoints, prepareGuest, validateRedemption } from "./loyalty";
import { refreshLoan } from "./interest";
import { shiftStockSnapshots, stockAt } from "./stock";
import { validateEntryUniqueness } from "./constraints";
import { baseModule, CUSTOMER_KEYS, decimal, EMPLOYEE_KEYS, ledgerFor, money, normalizeRow, positive, PRODUCT_KEYS, quantity, referenceValue, rowsFromForm, safeFields, validateSchema, VENDOR_KEYS, type LedgerPosting, type NormalizedRow } from "./rules";

type Transaction = Prisma.TransactionClient;
export class PetrosoftError extends Error { constructor(message: string, public status = 400) { super(message); } }
function assertGovernmentDocumentUnlocked(module: string, fields: PetrosoftFields) {
  if (!["generated-invoices", "eway-bills"].includes(module)) return;
  const integrations = jsonFields(fields.integrations);
  const locked = Object.values(integrations).some(value => ["pending", "unknown", "generated"].includes(fieldValue(jsonFields(value), "status")));
  if (locked || !Object.keys(integrations).length && (fields.provider_status === "generated" || Boolean(fieldValue(fields, ["irn", "eway_bill_no"]).replace(/^0$/, "")))) {
    throw new PetrosoftError("Cancel the government document and check its service status before changing this invoice.", 409);
  }
}
export interface ActionInput { module: string; operation?: string; action?: string; formIndex?: number; id?: string; ids?: string[]; fields?: PetrosoftFields }

export async function transaction<T>(operation: (database: Transaction) => Promise<T>, timeout = 60000): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await petrosoftDb.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout }); }
    catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt === 2) throw error; }
  }
  throw new PetrosoftError("Another entry is being saved. Please try again.", 409);
}

async function nextNumber(database: Transaction, workspaceId: string, module: string) {
  const result = await database.petrosoftSequence.upsert({ where: { workspaceId_module: { workspaceId, module } },
    update: { value: { increment: 1 } }, create: { workspaceId, module, value: 1 } });
  return result.value;
}

async function audit(database: Transaction, actor: PetrosoftActor, module: string, action: string, entryId?: string, before?: unknown, after?: unknown) {
  return database.petrosoftAudit.create({ data: { workspaceId: actor.workspaceId, userId: actor.id, username: actor.username,
    module, action, entryId, ...(before ? { before: JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue } : {}),
    ...(after ? { after: JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue } : {}) } });
}

export async function entity(database: Transaction, workspaceId: string, module: string, id: string) {
  if (!id) return null;
  return database.petrosoftEntry.findFirst({ where: { workspaceId, module, status: { not: "void" },
    OR: [{ id }, { externalId: id }, { name: { equals: id, mode: "insensitive" } }] } });
}

async function book(database: Transaction, workspaceId: string, entryId: string, date: Date, posts: LedgerPosting[], selfId: string) {
  const previous = await database.petrosoftLedger.findMany({ where: { entryId } });
  const oldDate = previous[0]?.date;
  if (oldDate && oldDate.getTime() !== date.getTime()) {
    await adjustStockSnapshots(database, workspaceId, oldDate, previous, []);
    await adjustStockSnapshots(database, workspaceId, date, [], posts);
  } else await adjustStockSnapshots(database, workspaceId, date, previous, posts);
  await database.petrosoftLedger.deleteMany({ where: { entryId } });
  if (posts.length) await database.petrosoftLedger.createMany({ data: posts.map(post => ({ entryId, date,
    entityType: post.entityType, entityId: post.entityId === "__SELF__" ? selfId : post.entityId,
    debit: money(post.debit ?? 0), credit: money(post.credit ?? 0), quantity: quantity(post.quantity ?? 0), description: post.description || "" })) });
}

async function enrichRow(database: Transaction, actor: PetrosoftActor, module: ModuleSchema, input: PetrosoftFields, fallbackDate: Date, editing = false) {
  const fields = { ...input };
  const base = baseModule(module.id);
  // Match unusual legacy field names to their visible labels without discarding them.
  for (const form of module.forms) for (const field of form.fields) {
    const value = fieldValue(fields, field.name);
    if (!value || field.type === "hidden") continue;
    const label = field.label.toLowerCase();
    if (!fieldValue(fields, "quantity") && /\b(qty|quantity|qnty)\b/.test(label) && !/test|last|stock|gross/.test(label)) fields.quantity = value;
    if (!fieldValue(fields, "price") && /^(rate|price|sale rate)\b/.test(label)) fields.price = value;
    if (!fieldValue(fields, "amount") && /^(received amount|paid amount|amount|credit amt|swipe amount|expense amount|cost)\b/.test(label)) fields.amount = value;
  }
  const productType = /lubricant/.test(base) || base === "other-purchases" ? "lubricants" : /gift/.test(base) ? "gifts" : "fuel-products";
  const productId = fieldValue(fields, PRODUCT_KEYS);
  const product = productId ? await entity(database, actor.workspaceId, productType, productId) : null;
  if (product) {
    fields.product = product.externalId || String(product.number);
    fields.product_name = product.name;
    const properties = jsonFields(product.fields);
    if (!fieldValue(fields, ["price", "purrate", "sale_rate", "rate"]) && !/purchase/.test(base)) {
      const rates = await database.petrosoftEntry.findMany({ where: { workspaceId: actor.workspaceId, module: "daily-rates", date: { lte: fallbackDate }, status: { not: "void" } }, orderBy: [{ date: "desc" }, { number: "desc" }], take: 100 });
      const selected = rates.find(rate => fieldValue(jsonFields(rate.fields), PRODUCT_KEYS) === fields.product);
      fields.price = selected?.rate.toString() || fieldValue(properties, ["sale_rate", "price"], "0");
    }
    fields.gst = fieldValue(properties, "gst", "0");
    fields.vat_rate = fieldValue(properties, "vat", "0");
    fields.tcs_rate = fieldValue(properties, "tcs", "0");
    fields.lfr_rate = fieldValue(properties, "lfr", "0");
  }
  const customerId = ["guest-sales", "gift-sales"].includes(base) ? "" : referenceValue(fields, CUSTOMER_KEYS);
  if (customerId && module.kind !== "master") {
    const customer = await entity(database, actor.workspaceId, "customers", customerId);
    if (!customer) throw new PetrosoftError("Choose a customer belonging to this station.");
    if (!editing && customer.status === "inactive" && /credit-sales/.test(base)) throw new PetrosoftError("Activate this customer before recording a new credit sale.");
    fields.customer_id = customer.externalId || String(customer.number); fields.organiz = fields.customer_id; fields.organization_name = customer.name;
    const properties = jsonFields(customer.fields);
    if (base === "credit-sales" && !fieldValue(fields, ["credit_discnt", "discount"])) {
      const productDiscounts = Array.isArray(properties.product_discounts) ? properties.product_discounts as PetrosoftFields[] : [];
      const offer = productDiscounts.find(discount => String(discount.product) === String(fields.product)) || properties;
      const offerAmount = fieldNumber(offer, ["disc_offer", "discount"]);
      if (offerAmount > 0) {
        const count = quantity(fieldValue(fields, ["qnty", "quantity"], "0"));
        const rate = decimal(fieldValue(fields, ["price", "rate"], "0"));
        fields.credit_discnt = /cash|percent/i.test(fieldValue(offer, "offer_type", "Qty")) ? money(count.mul(rate).mul(offerAmount).div(100)).toString() : money(count.mul(offerAmount)).toString();
      }
    }
  }
  const employeeId = fieldValue(fields, EMPLOYEE_KEYS);
  if (employeeId && module.kind !== "master") {
    const employee = await entity(database, actor.workspaceId, "employees", employeeId);
    if (employee) { fields.employee_id = employee.externalId || String(employee.number); fields.employee_name = employee.name; fields.employee = fields.employee_id; }
  }
  const vendorId = referenceValue(fields, VENDOR_KEYS);
  if (vendorId && module.kind !== "master") {
    const vendor = await entity(database, actor.workspaceId, "vendors", vendorId);
    if (vendor) { fields.vendor_id = vendor.externalId || String(vendor.number); fields.vendor_name = vendor.name; }
  }
  return fields;
}

async function cashBalance(database: Transaction, workspaceId: string, date: Date, before = false, excluding?: string) {
  return cashAt(database, workspaceId, date, before, excluding);
}

async function normalizeSettlement(database: Transaction, actor: PetrosoftActor, input: PetrosoftFields, id?: string): Promise<{ row: NormalizedRow; posts: LedgerPosting[] }> {
  const date = dateValue(fieldValue(input, ["insert_date", "date", "_date"]));
  const duplicate = await database.petrosoftEntry.count({ where: { workspaceId: actor.workspaceId, module: 'settlements', date, status: { not: 'void' }, ...(id ? { id: { not: id } } : {}) } });
  if (duplicate) throw new PetrosoftError('This date is already settled. Edit its existing settlement.',409);
  const actualOpening = await cashBalance(database, actor.workspaceId, date, true, id);
  const opening = money(fieldValue(input, ["opencash", "opening_cash"], actualOpening.toString()));
  const endBalance = await cashBalance(database, actor.workspaceId, date, false, id);
  const dayNet = endBalance.sub(actualOpening);
  const posts: LedgerPosting[] = [];
  const adjustment = opening.sub(actualOpening);
  if (!adjustment.isZero()) posts.push({ entityType: "cash", entityId: "cash", debit: adjustment.gt(0) ? adjustment : 0, credit: adjustment.lt(0) ? adjustment.abs() : 0 });
  let inflow = money(0), outflow = money(0);
  const list = (name: string) => Array.isArray(input[`${name}[]`]) ? input[`${name}[]`] as unknown[] : input[name] === undefined ? [] : [input[name]];
  for (const [names, incoming] of [["received_amt", true], ["receivedDealerAmt", true], ["hand_amt", false], ["toDealer", false]] as const) {
    for (const [index, value] of list(names).entries()) {
      if (!String(value || "").trim()) continue;
      const amount = positive(value, incoming ? "Cash received" : "Cash handed over", true);
      if (amount.isZero()) continue;
      if (incoming) inflow = inflow.add(amount); else outflow = outflow.add(amount);
      posts.push({ entityType: "cash", entityId: "cash", debit: incoming ? amount : 0, credit: incoming ? 0 : amount });
      const counterparty = String(list(incoming ? "received" : "handed")[index] || "owner");
      const counterType = String(list(incoming ? "inflwtype" : "outtype")[index] || "Owner");
      posts.push({ entityType: /bank/i.test(counterType) ? "bank" : "party", entityId: counterparty, debit: incoming ? 0 : amount, credit: incoming ? amount : 0 });
    }
  }
  const petty = money(fieldValue(input, "pettycash", "0"));
  if (petty.gt(0)) { outflow = outflow.add(petty); posts.push({ entityType: "cash", entityId: "cash", credit: petty }, { entityType: "expense", entityId: "petty-cash", debit: petty }); }
  const closing = money(opening.add(dayNet).add(inflow).sub(outflow));
  const fields = { ...input, opencash: opening.toString(), finialbankamt: dayNet.toString(), totinflw: inflow.toString(), total_outflow: outflow.toString(), closecash: closing.toString(), _date: date.toISOString().slice(0, 10) };
  return { row: { name: "Day Settlement", date, amount: closing, quantity: quantity(0), rate: quantity(0), fields, status: "active" }, posts };
}

async function protectUser(database: Transaction, actor: PetrosoftActor, username: string, losesAccess: boolean, permissions?: string[]) {
  const account = await database.petrosoftUser.findUnique({ where: { workspaceId_username: { workspaceId: actor.workspaceId, username } } });
  if (!account) return;
  if (losesAccess && account.id === actor.id) throw new PetrosoftError("You cannot remove access to your own account.");
  if (Array.isArray(account.permissions) && account.permissions.includes("*") && (losesAccess || permissions && !permissions.includes("*"))) {
    const other = await database.petrosoftUser.count({ where: { workspaceId: actor.workspaceId, id: { not: account.id }, active: true, permissions: { array_contains: ["*"] } } });
    if (!other) throw new PetrosoftError("Keep at least one active Super Admin account.", 409);
  }
}

async function saveUser(database: Transaction, actor: PetrosoftActor, fields: PetrosoftFields, entryId?: string) {
  const username = fieldValue(fields, ["username", "user_name", "u_name", "uname", "name"]);
  const password = fieldValue(fields, ["password", "user_pass", "u_pass", "pwd", "pass"]);
  if (!username) throw new PetrosoftError("Enter the username.");
  const original = entryId ? await database.petrosoftEntry.findFirst({ where: { id: entryId, workspaceId: actor.workspaceId, module: "users" } }) : null;
  const originalName = original ? fieldValue(jsonFields(original.fields), ["username", "user_name"], original.name) : username;
  const existing = await database.petrosoftUser.findUnique({ where: { workspaceId_username: { workspaceId: actor.workspaceId, username: originalName } } });
  const duplicate = username !== originalName ? await database.petrosoftUser.findUnique({ where: { workspaceId_username: { workspaceId: actor.workspaceId, username } } }) : null;
  if (duplicate && duplicate.id !== existing?.id) throw new PetrosoftError("This username already belongs to another user.", 409);
  if (!existing && !password) throw new PetrosoftError("Enter a password for the new user.");
  if (password && password.length < 4) throw new PetrosoftError("Use a password with at least four characters.");
  const roleId = fieldValue(fields, ["role", "user_role", "role_name"], "Operator");
  const roleEntry = await entity(database, actor.workspaceId, "roles", roleId);
  const role = roleEntry?.name || roleId;
  const configured = jsonFields(roleEntry?.fields).permissions;
  const permissions = Array.isArray(configured) ? configured.map(String) : Array.isArray(fields.permissions) ? fields.permissions.map(String) : role === "Super Admin" ? ["*"] : ["dashboard", "meter-sales", "credit-sales", "recoveries", "swipes", "expenses"];
  const active = fieldValue(fields, "status", "active") !== "inactive";
  await protectUser(database, actor, originalName, !active, permissions);
  const data = { username, fullName: fieldValue(fields, ["full_name", "employee_name", "name", "user_name"], username), role, permissions, active, ...(password ? { passwordHash: hashPassword(password) } : {}) };
  if (existing) return database.petrosoftUser.update({ where: { id: existing.id }, data });
  return database.petrosoftUser.create({ data: { ...data, workspaceId: actor.workspaceId, passwordHash: hashPassword(password) } });
}

async function saveEntry(database: Transaction, actor: PetrosoftActor, module: ModuleSchema, row: NormalizedRow, posts: LedgerPosting[], existingId?: string) {
  const existing = existingId ? await database.petrosoftEntry.findFirst({ where: { id: existingId, workspaceId: actor.workspaceId, module: module.id, status: { not: "void" } } }) : null;
  if (existingId && !existing) throw new PetrosoftError("This entry does not belong to this station.", 404);
  const number = existing?.number || await nextNumber(database, actor.workspaceId, module.id);
  const fields = safeFields({ ...row.fields, ...(module.id === "tanks" && !fieldValue(row.fields, "tank_no") ? { tank_no: `T${number}` } : {}), transaction_no: existing ? fieldValue(jsonFields(existing.fields), "transaction_no", String(number)) : String(number) });
  const previousPosts = existing ? await database.petrosoftLedger.findMany({ where: { entryId: existing.id } }) : [];
  await validateConsumableBalances(database, actor.workspaceId, previousPosts, posts);
  if (module.id === "opening-stock") {
    const tank = fieldValue(row.fields, "tank_no");
    if (existing && (existing.date.getTime() !== row.date.getTime() || fieldValue(jsonFields(existing.fields), "tank_no") !== tank)) throw new PetrosoftError("Keep the stock entry's date and tank when editing it. Delete the old entry to move it.");
    const previousClosing = existing ? quantity(fieldValue(jsonFields(existing.fields), "close_stock", "0")) : await stockAt(database, actor.workspaceId, tank, row.date);
    await shiftStockSnapshots(database, actor.workspaceId, tank, row.date, quantity(fieldValue(row.fields, "close_stock", "0")).sub(previousClosing), existing?.id);
  }
  if (module.id === "settlements") {
    if (existing && existing.date.getTime() !== row.date.getTime()) throw new PetrosoftError("Delete the old settlement before creating it on a different date.");
    const change = existing ? row.amount.sub(existing.amount) : cashMovement(posts);
    await adjustCashSnapshots(database, actor.workspaceId, row.date, change, existing?.id, true);
  } else if (existing && existing.date.getTime() !== row.date.getTime()) {
    await adjustCashSnapshots(database, actor.workspaceId, existing.date, cashMovement(previousPosts).neg());
    await adjustCashSnapshots(database, actor.workspaceId, row.date, cashMovement(posts));
  } else await adjustCashSnapshots(database, actor.workspaceId, row.date, cashMovement(posts).sub(cashMovement(previousPosts)));
  const data = { name: row.name || fieldValue(row.fields, ["organization_name", "product_name", "vendor_name", "employee_name"], module.title), date: row.date, amount: row.amount, quantity: row.quantity, rate: row.rate, status: row.status, fields };
  const entry = existing ? await database.petrosoftEntry.update({ where: { id: existing.id }, data })
    : await database.petrosoftEntry.create({ data: { ...data, workspaceId: actor.workspaceId, module: module.id, number, externalId: String(number), createdBy: actor.username } });
  if (existing) await removeLinkedEntries(database, existing, true);
  await book(database, actor.workspaceId, entry.id, row.date, posts, entry.externalId || String(number));
  await audit(database, actor, module.id, existing ? "UPDATE" : "CREATE", entry.id, existing ? { fields: existing.fields, amount: existing.amount } : undefined, { fields: entry.fields, amount: entry.amount });
  await synchronizeFinancialLinks(database, entry, posts, (moduleId, child, childPosts = [], id) => saveEntry(database, actor, moduleById.get(moduleId)!, child, childPosts, id));
  return entry;
}

async function validateConsumableBalances(database: Transaction, workspaceId: string, before: LedgerPosting[], after: LedgerPosting[]) {
  const changes = new Map<string, { type: string; id: string; quantity: Prisma.Decimal }>();
  for (const [posts, sign] of [[before, -1], [after, 1]] as const) for (const post of posts) {
    if (post.entityType !== "loyalty" && !(post.entityType === "product" && post.entityId.startsWith("gift:"))) continue;
    const key = `${post.entityType}:${post.entityId}`, row = changes.get(key) || { type: post.entityType, id: post.entityId, quantity: quantity(0) };
    row.quantity = row.quantity.add(quantity(post.quantity || 0).mul(sign)); changes.set(key, row);
  }
  for (const change of changes.values()) {
    if (change.quantity.gte(0)) continue;
    const current = await database.petrosoftLedger.aggregate({ where: { entityType: change.type, entityId: change.id, entry: { workspaceId, status: { not: "void" } } }, _sum: { quantity: true } });
    if (quantity(current._sum.quantity || 0).add(change.quantity).lt(0)) throw new PetrosoftError(change.type === "loyalty" ? "Reverse the guest's gift redemptions before reducing earned points." : "Reverse issued gifts before reducing their purchased stock.", 409);
  }
}

export async function executeAction(actor: PetrosoftActor, input: ActionInput) {
  const selectedModule = moduleById.get(input.module);
  if (!selectedModule) throw new PetrosoftError("Choose a valid Petrosoft module.", 404);
  let moduleSchema: ModuleSchema = selectedModule;
  const operation = input.operation || "save";
  const permission = operation === "save" ? input.id || moduleSchema.kind === "settings" ? "edit" : "create" : operation === "generate" ? "create" : operation === "pay" || operation === "reset-bills" ? "edit" : operation.startsWith("preview") ? "view" : operation;
  if (!hasPermission(actor, moduleSchema.id, permission)) throw new PetrosoftError("Your role does not have permission to perform this action.", 403);
  let fields = Object.fromEntries(Object.entries(jsonFields(input.fields)).filter(([key]) => !key.startsWith("_") || key === "_date"));
  let originalFields: PetrosoftFields | undefined;
  if (operation === "filter" || operation === "report") return { module: moduleSchema.id, filters: fields };
  return transaction(async database => {
    const save = async (moduleId: string, row: NormalizedRow, posts: LedgerPosting[] = [], id?: string) => {
      const schema = moduleById.get(moduleId);
      if (!schema) throw new PetrosoftError("Unknown record type.");
      return saveEntry(database, actor, schema, row, posts, id);
    };
    if (["sale-invoices", "statements", "brs-generation", "vrs-generation"].includes(moduleSchema.id) && ["save", "generate"].includes(operation)) {
      const result = await generateDocuments(database, actor, moduleSchema.id, fields, input.ids || [], save);
      if (result) return result;
    }
    if (["delete", "toggle", "reconcile"].includes(operation)) {
      const ids = input.ids?.length ? input.ids : input.id ? [input.id] : [];
      if (!ids.length) throw new PetrosoftError("Select at least one entry.");
      const entries = await database.petrosoftEntry.findMany({ where: { workspaceId: actor.workspaceId, module: moduleSchema.id, id: { in: ids }, status: { not: "void" } } });
      if (entries.length !== ids.length) throw new PetrosoftError("One or more entries do not belong to this station.", 404);
      for (const entry of entries) {
        assertGovernmentDocumentUnlocked(entry.module, jsonFields(entry.fields));
        const parent = await sourceParent(database, entry);
        if (parent && ["vendor-transactions", "business-transactions"].includes(entry.module)) throw new PetrosoftError("Change this posting through its original transaction so all related balances stay together.", 409);
        if (operation === "delete") {
          if (fieldValue(jsonFields(entry.fields), "invoice_id")) throw new PetrosoftError("Cancel this sale's generated invoice before changing the sale.", 409);
          if (moduleSchema.id === "generated-invoices") {
            const sources = await database.petrosoftEntry.findMany({ where: { workspaceId: actor.workspaceId, fields: { path: ["invoice_id"], equals: entry.id } } });
            for (const source of sources) { const fields = jsonFields(source.fields); delete fields.invoice_id; delete fields.invoice_number; await database.petrosoftEntry.update({ where: { id: source.id }, data: { fields: safeFields(fields) } }); }
          }
          if (moduleSchema.id === "opening-stock") {
            const tank = fieldValue(jsonFields(entry.fields), "tank_no"), recalculated = await stockAt(database, actor.workspaceId, tank, entry.date, entry.id);
            await shiftStockSnapshots(database, actor.workspaceId, tank, entry.date, recalculated.sub(fieldValue(jsonFields(entry.fields), "close_stock", "0")), entry.id);
          }
          if (moduleSchema.id === "interest" && jsonFields(entry.fields).type === "Loan" && await database.petrosoftEntry.count({ where: { workspaceId: actor.workspaceId, module: "interest", status: { not: "void" }, fields: { path: ["loan_id"], equals: entry.id } } })) throw new PetrosoftError("Reverse this loan's repayments before deleting the loan.", 409);
          if (moduleSchema.id === "users") {
            const username = fieldValue(jsonFields(entry.fields), ["username", "user_name"], entry.name);
            await protectUser(database, actor, username, true);
            const account = await database.petrosoftUser.findUnique({ where: { workspaceId_username: { workspaceId: actor.workspaceId, username } } });
            if (account) { await database.petrosoftSession.deleteMany({ where: { userId: account.id } }); await database.petrosoftUser.update({ where: { id: account.id }, data: { active: false } }); }
          }
          if (moduleSchema.kind === "master") {
            const types: Record<string, string[]> = { customers: ["customer"], vendors: ["vendor"], employees: ["employee", "employee-advance"], "swipe-machines": ["swipe"], "business-parties": ["bank", "party"], "fuel-products": ["product"], lubricants: ["product"], gifts: ["product"] };
            const type = types[moduleSchema!.id] || [];
            const externalId = `${moduleSchema!.id === "lubricants" ? "lub:" : moduleSchema!.id === "gifts" ? "gift:" : ""}${entry.externalId || String(entry.number)}`;
            const linked = type.length ? await database.petrosoftLedger.count({ where: { entityType: { in: type }, entityId: externalId, entry: { workspaceId: actor.workspaceId, id: { not: entry.id }, status: { not: "void" } } } }) : 0;
            if (linked || await hasMasterReferences(database, entry)) throw new PetrosoftError("This master is used by existing transactions. Deactivate it to keep its history.", 409);
          }
          const posts = await database.petrosoftLedger.findMany({ where: { entryId: entry.id } });
          await validateConsumableBalances(database, actor.workspaceId, posts, []);
          const cashChange = moduleSchema.id === "settlements" ? (await cashAt(database, actor.workspaceId, entry.date, false, entry.id)).sub(entry.amount) : cashMovement(posts).neg();
          await adjustCashSnapshots(database, actor.workspaceId, entry.date, cashChange, entry.id, moduleSchema.id === "settlements");
          await removeLinkedEntries(database, entry);
          await adjustStockSnapshots(database, actor.workspaceId, entry.date, posts, []);
          await database.petrosoftLedger.deleteMany({ where: { entryId: entry.id } });
          await database.petrosoftEntry.update({ where: { id: entry.id }, data: { status: "void" } });
          if (moduleSchema.id === "interest" && fieldValue(jsonFields(entry.fields), "loan_id")) await refreshLoan(database, fieldValue(jsonFields(entry.fields), "loan_id"));
        } else if (operation === "toggle") {
          if (moduleSchema!.id === "users" && fieldValue(jsonFields(entry.fields), ["user_name", "username"], entry.name) === actor.username) throw new PetrosoftError("You cannot deactivate your own account.");
          const status = entry.status === "active" ? "inactive" : "active";
          if (moduleSchema.id === "users") await protectUser(database, actor, fieldValue(jsonFields(entry.fields), ["username", "user_name"], entry.name), status === "inactive");
          await database.petrosoftEntry.update({ where: { id: entry.id }, data: { status } });
          if (moduleSchema.id === "users") {
            const username = fieldValue(jsonFields(entry.fields), ["username", "user_name"], entry.name), account = await database.petrosoftUser.findUnique({ where: { workspaceId_username: { workspaceId: actor.workspaceId, username } } });
            if (!account && status === "active") throw new PetrosoftError("Set a local password before activating this user's login.");
            await database.petrosoftUser.updateMany({ where: { workspaceId: actor.workspaceId, username }, data: { active: status === "active" } });
            if (account && status === "inactive") await database.petrosoftSession.deleteMany({ where: { userId: account.id } });
          }
        } else {
          await database.petrosoftEntry.update({ where: { id: entry.id }, data: { fields: safeFields({ ...jsonFields(entry.fields), reconciled: true, reconciled_date: today().toISOString().slice(0, 10) }) } });
        }
        await audit(database, actor, moduleSchema.id, operation.toUpperCase(), entry.id, { fields: entry.fields, amount: entry.amount });
      }
      return { message: operation === "delete" ? "Selected entries deleted and their balances updated." : operation === "toggle" ? "Status updated." : "Transactions reconciled.", count: entries.length };
    }
    if (moduleSchema.id === "password") {
      const current = fieldValue(fields, ["oldPwd", "current_password", "old_password", "old_pwd", "old_pass", "password"]);
      const next = fieldValue(fields, ["newPwd", "new_password", "new_pwd", "new_pass", "newpassword"]);
      const repeat = fieldValue(fields, ["conPwd", "confirm_password", "confirm_pwd", "re_password", "renew_pwd", "re_new_pass"]);
      if (!verifyPassword(current, actor.passwordHash)) throw new PetrosoftError("Your current password is incorrect.");
      if (!next || next.length < 4) throw new PetrosoftError("Enter a new password with at least four characters.");
      if (next !== repeat) throw new PetrosoftError("The new passwords do not match.");
      await database.petrosoftUser.update({ where: { id: actor.id }, data: { passwordHash: hashPassword(next) } });
      await database.petrosoftSession.deleteMany({ where: { userId: actor.id } });
      await audit(database, actor, moduleSchema.id, "PASSWORD_CHANGED");
      return { message: "Password changed. Sign in with your new password.", redirect: "/petrosoft/login" };
    }
    if (moduleSchema.id === "settings" && operation === "reset-bills") {
      await database.petrosoftSequence.upsert({ where: { workspaceId_module: { workspaceId: actor.workspaceId, module: "credit-bill" } }, create: { workspaceId: actor.workspaceId, module: "credit-bill", value: 0 }, update: { value: 0 } });
      await audit(database, actor, "settings", "BILL_SEQUENCE_RESET");
      return { message: "The next credit bill number is reset to 1." };
    }
    if (["organization", "settings", "print-templates"].includes(moduleSchema.id)) {
      const previous = jsonFields(actor.workspace.settings);
      const featureIds = moduleSchema.id === "settings" ? (Array.isArray(fields["page_id[]"]) ? fields["page_id[]"].map(String) : []) : Array.isArray(previous.feature_ids) ? previous.feature_ids.map(String) : [];
      const settings = safeFields({ ...previous, ...fields, ...(moduleSchema.id === "settings" ? { feature_ids: featureIds, purchase_policy: {
        lfr_tot: featureIds?.includes("1") ? "yes" : "no", delar_comm: featureIds?.includes("2") ? "yes" : "no", lfr_incl: featureIds?.includes("3") ? "yes" : "no", del_incl: featureIds?.includes("24") ? "yes" : "no", lfr_other: featureIds?.includes("35") ? "yes" : "no",
      } } : {}) });
      await database.petrosoftWorkspace.update({ where: { id: actor.workspaceId }, data: { settings,
        ...(moduleSchema.id === "organization" && fieldValue(fields, "company_name") ? { name: fieldValue(fields, "company_name") } : {}) } });
      await audit(database, actor, moduleSchema.id, "SETTINGS_UPDATED", undefined, safeFields(previous), safeFields(fields));
      return { message: "Settings saved." };
    }
    if (moduleSchema.id === "roles" && fields.permissions !== undefined && !Array.isArray(fields.permissions)) throw new PetrosoftError("Choose valid role permissions.");
    const originalSchema = formFor(moduleSchema, input.formIndex, input.action);
    if (/save_advance/.test(originalSchema?.action || input.action || "")) {
      moduleSchema = moduleById.get("recoveries")!;
      fields = { ...fields, insert_date: fieldValue(fields, "date_input"), rec_organiz: fieldValue(fields, "org_input"), paid_amt: fieldValue(fields, "adv_input"), rec_emp: fieldValue(fields, "employeeName"), re_type: fieldValue(fields, "mode", "Cash"), rec_desc: fieldValue(fields, "description"), advance: true };
    }
    if (moduleSchema.id === "shift-sheet") { moduleSchema = moduleById.get("daily-rates")!; fields = { ...fields, _upsertRates: true }; }
    if (input.id) {
      const previous = await database.petrosoftEntry.findFirst({ where: { id: input.id, workspaceId: actor.workspaceId, module: moduleSchema.id, status: { not: "void" } } });
      if (!previous) throw new PetrosoftError("This entry does not belong to this station.", 404);
      assertGovernmentDocumentUnlocked(previous.module, jsonFields(previous.fields));
      if (fieldValue(jsonFields(previous.fields), "invoice_id")) throw new PetrosoftError("Cancel this sale's generated invoice before editing the sale.", 409);
      const parent = await sourceParent(database, previous);
      if (parent && ["vendor-transactions", "business-transactions"].includes(previous.module)) throw new PetrosoftError("Edit this posting through its original transaction.", 409);
      const inherited = jsonFields(previous.fields); delete inherited._date;
      originalFields = jsonFields(previous.fields);
      fields = { ...inherited, ...fields };
    }
    const custom = await domainAction(database, actor, moduleSchema.id, operation, fields, input.id, save);
    if (custom !== undefined) return custom;
    if (moduleSchema.id === "roles") {
      const offered = Array.isArray(fields.permissions) ? fields.permissions.map(String) : Array.isArray(fields.page_ids) ? permissionsForPages(fields.page_ids) : [];
      const known = new Set(Object.values(rolePages));
      if (offered.some(value => value !== "*" && !known.has(value) && !moduleById.has(value))) throw new PetrosoftError("Choose valid role permissions.");
      if (!Array.isArray(actor.permissions) || !actor.permissions.includes("*")) for (const value of offered) {
        const [target, action] = value.split(":");
        if (value === "*" || !hasPermission(actor, target, action || "view")) throw new PetrosoftError("You can grant only permissions that your own role has.", 403);
      }
      fields.permissions = offered; fields.page_ids = pagesForPermissions(offered);
      if (input.id) {
        const previous = await database.petrosoftEntry.findUnique({ where: { id: input.id } });
        if (previous) {
          const users = await database.petrosoftUser.findMany({ where: { workspaceId: actor.workspaceId, role: previous.name } });
          if (!offered.includes("*") && users.some(user => user.active && Array.isArray(user.permissions) && user.permissions.includes("*"))) {
            const otherAdmins = await database.petrosoftUser.count({ where: { workspaceId: actor.workspaceId, active: true, role: { not: previous.name }, permissions: { array_contains: ["*"] } } });
            if (!otherAdmins) throw new PetrosoftError("Keep at least one active Super Admin role.", 409);
          }
          await database.petrosoftUser.updateMany({ where: { workspaceId: actor.workspaceId, role: previous.name }, data: { role: fieldValue(fields, "role_name", previous.name), permissions: offered } });
        }
      }
    }
    const schema = formFor(moduleSchema, input.formIndex, input.action);
    const rows = rowsFromForm(moduleSchema, fields);
    if (!(moduleSchema.id === "daily-rates" && input.id)) {
      if (Array.isArray(fields.rows)) for (const row of rows) validateSchema(moduleSchema, schema?.index, row, Boolean(input.id));
      else validateSchema(moduleSchema, schema?.index, fields, Boolean(input.id));
    }
    if (!rows.length) throw new PetrosoftError("Enter at least one row before saving.");
    if (input.id && rows.length > 1 && !/purchase/.test(moduleSchema.id)) throw new PetrosoftError("Edit one transaction at a time.");
    let normalized: { row: NormalizedRow; posts: LedgerPosting[]; existingId?: string }[] = [];
    const saleTotals = new Map<string, Prisma.Decimal>();
    const giftTotals = new Map<string, Prisma.Decimal>();
    const seen = new Set<string>();
    for (const raw of rows) {
      if (moduleSchema.id === "settlements") { normalized.push(await normalizeSettlement(database, actor, raw, input.id)); continue; }
      const approximateDate = (() => { try { return dateValue(fieldValue(raw, ["insert_date", "pur_date", "_date", "date"])); } catch { return today(); } })();
      const guestFields = baseModule(moduleSchema.id) === "guest-sales" ? await prepareGuest(database, actor, raw, approximateDate, save) : raw;
      let enriched = await enrichRow(database, actor, moduleSchema, guestFields, approximateDate, Boolean(input.id));
      if (moduleSchema.id === "gift-sales") enriched = jsonFields(await validateRedemption(database, actor, enriched, input.id, giftTotals));
      await validateMasterReferences(database, actor.workspaceId, moduleSchema.id, enriched, originalFields);
      if (/purchase/.test(moduleSchema.id)) enriched._purchase_policy = { delar_comm: "no", lfr_tot: "no", lfr_incl: "no", del_incl: "no", ...jsonFields(jsonFields(actor.workspace.settings).purchase_policy) };
      const row = normalizeRow(moduleSchema, enriched);
      await validateEntryUniqueness(database, actor.workspaceId, moduleSchema, row, seen, input.id);
      if (baseModule(moduleSchema.id) === "guest-sales") row.fields.points = (await earnedPoints(database, actor, row.fields, row.quantity)).toString();
      if (jsonFields(actor.workspace.settings).date_ctl === "yes" && moduleSchema.kind === "transaction" && moduleSchema.id !== "settlements") {
        const closed = await database.petrosoftEntry.count({ where: { workspaceId: actor.workspaceId, module: "settlements", date: row.date, status: { not: "void" } } });
        if (closed) throw new PetrosoftError("This date is settled. Unlock settled dates in Organization Details before changing its transactions.", 409);
      }
      if (moduleSchema.id === "daily-rates" && !input.id) {
        const duplicate = await database.petrosoftEntry.findFirst({ where: { workspaceId: actor.workspaceId, module: "daily-rates", date: row.date, status: { not: "void" }, fields: { path: ["product"], equals: fieldValue(row.fields, PRODUCT_KEYS) } } });
        if (duplicate && !fields._upsertRates) throw new PetrosoftError("A sale rate already exists for this product and date. Edit the existing rate.", 409);
        if (duplicate && fields._upsertRates) { normalized.push({ row, posts: [], existingId: duplicate.id }); continue; }
      }
      if (moduleSchema.id === "users") { const user = await saveUser(database, actor, enriched, input.id); row.fields.auth_user_id = user.id; }
      const posts = ledgerFor(moduleSchema, row);
      if (baseModule(moduleSchema.id) === "credit-sales") {
        const customer = await entity(database, actor.workspaceId, "customers", fieldValue(row.fields, CUSTOMER_KEYS));
        const limit = fieldNumber(jsonFields(customer?.fields), "credit_limit");
        if (limit > 0 && jsonFields(actor.workspace.settings).credit_limit === "yes") {
          const ledger = await database.petrosoftLedger.findMany({ where: { entityType: "customer", entityId: customer?.externalId || "", entry: { workspaceId: actor.workspaceId, status: { not: "void" }, ...(input.id ? { id: { not: input.id } } : {}) } } });
          const balance = ledger.reduce((sum, entry) => sum.add(entry.debit).sub(entry.credit), money(0));
          const key = customer!.externalId || customer!.id, batch = (saleTotals.get(key) || money(0)).add(row.amount); saleTotals.set(key, batch);
          if (balance.add(batch).gt(limit)) throw new PetrosoftError("This sale would exceed the customer's credit limit.", 409);
        }
      }
      normalized.push({ row, posts });
    }
    if (/purchase/.test(moduleSchema.id) || moduleSchema.id === "lfr-invoices") {
      const invoiceNumber = fieldValue(fields, ["invo_no", "invoice_no", "invoice_number"]);
      if (invoiceNumber && !input.id) {
        const duplicate = await database.petrosoftEntry.findFirst({ where: { workspaceId: actor.workspaceId, module: moduleSchema.id, status: { not: "void" }, fields: { path: ["invo_no"], equals: invoiceNumber } } });
        if (duplicate) throw new PetrosoftError("This invoice number is already recorded.", 409);
      }
      if (normalized.length >= 1) {
        const amount = normalized.reduce((total, item) => total.add(item.row.amount), money(0));
        const count = normalized.reduce((total, item) => total.add(item.row.quantity), quantity(0));
        const aggregate = normalized[0].row;
        const items = normalized.map(item => ({ ...safeFields({ ...item.row.fields, items: undefined }), amount: item.row.amount.toString(), quantity: item.row.quantity.toString(), rate: item.row.rate.toString() }));
        const rounding = money(fieldValue(fields, ["roundingoff", "roundoff"], "0")), dealer = moduleSchema.id === "fuel-purchases" ? normalized.reduce((sum, item) => sum.add(fieldValue(item.row.fields, "dealercomm", "0")), money(0)) : money(0), cashDiscount = money(fieldValue(fields, "cashdisc", "0"));
        const dealerAlreadyDeducted = jsonFields(jsonFields(actor.workspace.settings).purchase_policy).delar_comm === "yes" ? dealer : money(0);
        const total = money(amount.add(rounding).add(dealerAlreadyDeducted).sub(dealer).sub(cashDiscount));
        if (total.lte(0)) throw new PetrosoftError("Invoice total must be a positive amount.");
        const invoiceFields = { ...fields, ...aggregate.fields, items, payment_amnt: fieldValue(fields, "Payment") || !moduleSchema.forms.some(form => form.fields.some(field => field.name === "Payment")) ? fieldValue(fields, "payment_amnt", "0") : "0", total_amount: total.toString(), _batch: randomUUID() };
        if (money(invoiceFields.payment_amnt).gt(total)) throw new PetrosoftError("Payment cannot exceed the invoice total.");
        const invoiceRow = { ...aggregate, amount: total, quantity: count, fields: invoiceFields };
        normalized = [{ row: invoiceRow, posts: ledgerFor(moduleSchema, invoiceRow) }];
      }
    }
    const entries = [];
    for (const { row, posts, existingId } of normalized) {
      const entry = await saveEntry(database, actor, moduleSchema, row, posts, existingId || input.id);
      await synchronizeMasterChildren(database, actor, entry, row.fields, save);
      entries.push(entry);
    }
    return { message: `${entries.length === 1 ? "Entry" : `${entries.length} entries`} saved.`, entries: entries.map(entry => ({ id: entry.id, number: entry.number, amount: entry.amount.toString() })) };
  }, Array.isArray(fields.rows) ? Math.min(300000, Math.max(60000, fields.rows.length * 200)) : 60000);
}

export async function saveGenerated(actor: PetrosoftActor, moduleId: string, fields: PetrosoftFields, amount: unknown, name: string) {
  const moduleSchema = moduleById.get(moduleId);
  if (!moduleSchema || !hasPermission(actor, moduleId, "edit")) throw new PetrosoftError("Your role cannot generate this record.", 403);
  return transaction(async database => saveEntry(database, actor, moduleSchema, { name, date: today(), amount: money(amount), quantity: quantity(0), rate: quantity(0), fields, status: "active" }, []));
}
