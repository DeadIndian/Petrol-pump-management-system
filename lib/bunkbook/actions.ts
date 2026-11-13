import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { hasPermission, hashPassword, verifyPassword, type BunkBookActor } from "./auth";
import { dateValue, fieldNumber, fieldValue, formFor, jsonFields, moduleById, type ModuleSchema, type BunkBookFields, today } from "./catalog";
import { bunkbookDb } from "./db";
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
import { bowserDependency, prepareBowserSale } from "./bowser";
import { baseModule, BOWSER_KEYS, CUSTOMER_KEYS, decimal, EMPLOYEE_KEYS, ledgerFor, money, normalizeRow, positive, PRODUCT_KEYS, quantity, referenceValue, rowsFromForm, safeFields, validateSchema, VENDOR_KEYS, type LedgerPosting, type NormalizedRow } from "./rules";

type Transaction = Prisma.TransactionClient;
export class BunkBookError extends Error { constructor(message: string, public status = 400) { super(message); } }
function assertGovernmentDocumentUnlocked(module: string, fields: BunkBookFields) {
  if (!["generated-invoices", "eway-bills"].includes(module)) return;
  const integrations = jsonFields(fields.integrations);
  const locked = Object.values(integrations).some(value => ["pending", "unknown", "generated"].includes(fieldValue(jsonFields(value), "status")));
  if (locked || !Object.keys(integrations).length && (fields.provider_status === "generated" || Boolean(fieldValue(fields, ["irn", "eway_bill_no"]).replace(/^0$/, "")))) {
    throw new BunkBookError("Cancel the government document and check its service status before changing this invoice.", 409);
  }
}
export interface ActionInput { module: string; operation?: string; action?: string; formIndex?: number; id?: string; ids?: string[]; fields?: BunkBookFields }

export async function transaction<T>(operation: (database: Transaction) => Promise<T>, timeout = 60000): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await bunkbookDb.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout }); }
    catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt === 2) throw error; }
  }
  throw new BunkBookError("Another entry is being saved. Please try again.", 409);
}

async function nextNumber(database: Transaction, module: string) {
  const result = await database.bunkBookSequence.upsert({ where: { module },
    update: { value: { increment: 1 } }, create: { module, value: 1 } });
  return result.value;
}

async function audit(database: Transaction, actor: BunkBookActor, module: string, action: string, entryId?: string, before?: unknown, after?: unknown) {
  return database.bunkBookAudit.create({ data: { userId: actor.id, username: actor.username,
    module, action, entryId, ...(before ? { before: JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue } : {}),
    ...(after ? { after: JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue } : {}) } });
}

export async function entity(database: Transaction, module: string, id: string) {
  if (!id) return null;
  return database.bunkBookEntry.findFirst({ where: { module, status: { not: "void" },
    OR: [{ id }, { externalId: id }, { name: { equals: id, mode: "insensitive" } }] } });
}

async function book(database: Transaction, entryId: string, date: Date, posts: LedgerPosting[], selfId: string) {
  const previous = await database.bunkBookLedger.findMany({ where: { entryId } });
  const oldDate = previous[0]?.date;
  if (oldDate && oldDate.getTime() !== date.getTime()) {
    await adjustStockSnapshots(database, oldDate, previous, []);
    await adjustStockSnapshots(database, date, [], posts);
  } else await adjustStockSnapshots(database, date, previous, posts);
  await database.bunkBookLedger.deleteMany({ where: { entryId } });
  if (posts.length) await database.bunkBookLedger.createMany({ data: posts.map(post => ({ entryId, date,
    entityType: post.entityType, entityId: post.entityId === "__SELF__" ? selfId : post.entityId,
    debit: money(post.debit ?? 0), credit: money(post.credit ?? 0), quantity: quantity(post.quantity ?? 0), description: post.description || "" })) });
}

async function enrichRow(database: Transaction, _actor: BunkBookActor, module: ModuleSchema, input: BunkBookFields, fallbackDate: Date, editing = false) {
  const fields = { ...input };
  const base = baseModule(module.id);
  if (module.id.startsWith("bowser-") && module.id !== "bowser-nozzles") {
    const bowser = await entity(database, "bowsers", fieldValue(fields, BOWSER_KEYS));
    if (!bowser) throw new BunkBookError("Choose a bowser belonging to this station.");
    fields.bowser = bowser.externalId || String(bowser.number); fields.bowser_name = bowser.name;
    if (["bowser-sales", "bowser-credit-sales"].includes(module.id)) {
      const configuredProduct = fieldValue(jsonFields(bowser.fields), "product");
      const offeredProduct = fieldValue(fields, PRODUCT_KEYS);
      if (!configuredProduct) throw new BunkBookError("Configure the bowser's fuel product before entering sales.");
      if (offeredProduct && offeredProduct !== configuredProduct) throw new BunkBookError("The selected product does not belong to this bowser.");
      fields.product = configuredProduct;
    }
  }
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
  const product = productId ? await entity(database, productType, productId) : null;
  if (product) {
    fields.product = product.externalId || String(product.number);
    fields.product_name = product.name;
    const properties = jsonFields(product.fields);
    if (!fieldValue(fields, ["price", "purrate", "sale_rate", "rate"]) && !/purchase/.test(base)) {
      const rates = await database.bunkBookEntry.findMany({ where: { module: "daily-rates", date: { lte: fallbackDate }, status: { not: "void" } }, orderBy: [{ date: "desc" }, { number: "desc" }], take: 100 });
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
    const customer = await entity(database, "customers", customerId);
    if (!customer) throw new BunkBookError("Choose a customer belonging to this station.");
    if (!editing && customer.status === "inactive" && /credit-sales/.test(base)) throw new BunkBookError("Activate this customer before recording a new credit sale.");
    fields.customer_id = customer.externalId || String(customer.number); fields.organiz = fields.customer_id; fields.organization_name = customer.name;
    const properties = jsonFields(customer.fields);
    if (base === "credit-sales" && !fieldValue(fields, ["credit_discnt", "discount"])) {
      const productDiscounts = Array.isArray(properties.product_discounts) ? properties.product_discounts as BunkBookFields[] : [];
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
    const employee = await entity(database, "employees", employeeId);
    if (employee) { fields.employee_id = employee.externalId || String(employee.number); fields.employee_name = employee.name; fields.employee = fields.employee_id; }
  }
  const vendorId = referenceValue(fields, VENDOR_KEYS);
  if (vendorId && module.kind !== "master") {
    const vendor = await entity(database, "vendors", vendorId);
    if (vendor) { fields.vendor_id = vendor.externalId || String(vendor.number); fields.vendor_name = vendor.name; }
  }
  return fields;
}

async function cashBalance(database: Transaction, date: Date, before = false, excluding?: string) {
  return cashAt(database, date, before, excluding);
}

async function normalizeSettlement(database: Transaction, _actor: BunkBookActor, input: BunkBookFields, id?: string): Promise<{ row: NormalizedRow; posts: LedgerPosting[] }> {
  const date = dateValue(fieldValue(input, ["insert_date", "date", "_date"]));
  const duplicate = await database.bunkBookEntry.count({ where: { module: 'settlements', date, status: { not: 'void' }, ...(id ? { id: { not: id } } : {}) } });
  if (duplicate) throw new BunkBookError('This date is already settled. Edit its existing settlement.',409);
  const actualOpening = await cashBalance(database, date, true, id);
  const opening = money(fieldValue(input, ["opencash", "opening_cash"], actualOpening.toString()));
  const endBalance = await cashBalance(database, date, false, id);
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

async function protectUser(database: Transaction, actor: BunkBookActor, username: string, losesAccess: boolean, permissions?: string[]) {
  const account = await database.bunkBookUser.findUnique({ where: { username } });
  if (!account) return;
  if (losesAccess && account.id === actor.id) throw new BunkBookError("You cannot remove access to your own account.");
  if (Array.isArray(account.permissions) && account.permissions.includes("*") && (losesAccess || permissions && !permissions.includes("*"))) {
    const other = await database.bunkBookUser.count({ where: { id: { not: account.id }, active: true, permissions: { array_contains: ["*"] } } });
    if (!other) throw new BunkBookError("Keep at least one active Super Admin account.", 409);
  }
}

async function saveUser(database: Transaction, actor: BunkBookActor, fields: BunkBookFields, entryId?: string) {
  const username = fieldValue(fields, ["username", "user_name", "u_name", "uname", "name"]);
  const password = fieldValue(fields, ["password", "user_pass", "u_pass", "pwd", "pass"]);
  if (!username) throw new BunkBookError("Enter the username.");
  const original = entryId ? await database.bunkBookEntry.findFirst({ where: { id: entryId, module: "users" } }) : null;
  const originalName = original ? fieldValue(jsonFields(original.fields), ["username", "user_name"], original.name) : username;
  const existing = await database.bunkBookUser.findUnique({ where: { username: originalName } });
  const duplicate = username !== originalName ? await database.bunkBookUser.findUnique({ where: { username } }) : null;
  if (duplicate && duplicate.id !== existing?.id) throw new BunkBookError("This username already belongs to another user.", 409);
  if (!existing && !password) throw new BunkBookError("Enter a password for the new user.");
  if (password && password.length < 4) throw new BunkBookError("Use a password with at least four characters.");
  const roleId = fieldValue(fields, ["role", "user_role", "role_name"], "Operator");
  const roleEntry = await entity(database, "roles", roleId);
  const role = roleEntry?.name || roleId;
  const configured = jsonFields(roleEntry?.fields).permissions;
  const permissions = Array.isArray(configured) ? configured.map(String) : Array.isArray(fields.permissions) ? fields.permissions.map(String) : role === "Super Admin" ? ["*"] : ["dashboard", "meter-sales", "credit-sales", "recoveries", "swipes", "expenses"];
  const active = fieldValue(fields, "status", "active") !== "inactive";
  await protectUser(database, actor, originalName, !active, permissions);
  const data = { username, fullName: fieldValue(fields, ["full_name", "employee_name", "name", "user_name"], username), role, permissions, active, ...(password ? { passwordHash: hashPassword(password) } : {}) };
  if (existing) return database.bunkBookUser.update({ where: { id: existing.id }, data });
  return database.bunkBookUser.create({ data: { ...data, passwordHash: hashPassword(password) } });
}

async function saveEntry(database: Transaction, actor: BunkBookActor, module: ModuleSchema, row: NormalizedRow, posts: LedgerPosting[], existingId?: string) {
  const existing = existingId ? await database.bunkBookEntry.findFirst({ where: { id: existingId, module: module.id, status: { not: "void" } } }) : null;
  if (existingId && !existing) throw new BunkBookError("This entry does not belong to this station.", 404);
  const number = existing?.number || await nextNumber(database, module.id);
  const fields = safeFields({ ...row.fields, ...(module.id === "tanks" && !fieldValue(row.fields, "tank_no") ? { tank_no: `T${number}` } : {}), transaction_no: existing ? fieldValue(jsonFields(existing.fields), "transaction_no", String(number)) : String(number) });
  const previousPosts = existing ? await database.bunkBookLedger.findMany({ where: { entryId: existing.id } }) : [];
  await validateConsumableBalances(database, previousPosts, posts);
  if (module.id === "opening-stock") {
    const tank = fieldValue(row.fields, "tank_no");
    if (existing && (existing.date.getTime() !== row.date.getTime() || fieldValue(jsonFields(existing.fields), "tank_no") !== tank)) throw new BunkBookError("Keep the stock entry's date and tank when editing it. Delete the old entry to move it.");
    const previousClosing = existing ? quantity(fieldValue(jsonFields(existing.fields), "close_stock", "0")) : await stockAt(database, tank, row.date);
    await shiftStockSnapshots(database, tank, row.date, quantity(fieldValue(row.fields, "close_stock", "0")).sub(previousClosing), existing?.id);
  }
  if (module.id === "settlements") {
    if (existing && existing.date.getTime() !== row.date.getTime()) throw new BunkBookError("Delete the old settlement before creating it on a different date.");
    const change = existing ? row.amount.sub(existing.amount) : cashMovement(posts);
    await adjustCashSnapshots(database, row.date, change, existing?.id, true);
  } else if (existing && existing.date.getTime() !== row.date.getTime()) {
    await adjustCashSnapshots(database, existing.date, cashMovement(previousPosts).neg());
    await adjustCashSnapshots(database, row.date, cashMovement(posts));
  } else await adjustCashSnapshots(database, row.date, cashMovement(posts).sub(cashMovement(previousPosts)));
  const data = { name: row.name || fieldValue(row.fields, ["organization_name", "product_name", "vendor_name", "employee_name"], module.title), date: row.date, amount: row.amount, quantity: row.quantity, rate: row.rate, status: row.status, fields };
  const entry = existing ? await database.bunkBookEntry.update({ where: { id: existing.id }, data })
    : await database.bunkBookEntry.create({ data: { ...data, module: module.id, number, externalId: String(number), createdBy: actor.username } });
  if (existing) await removeLinkedEntries(database, existing, true);
  await book(database, entry.id, row.date, posts, entry.externalId || String(number));
  await audit(database, actor, module.id, existing ? "UPDATE" : "CREATE", entry.id, existing ? { fields: existing.fields, amount: existing.amount } : undefined, { fields: entry.fields, amount: entry.amount });
  await synchronizeFinancialLinks(database, entry, posts, (moduleId, child, childPosts = [], id) => saveEntry(database, actor, moduleById.get(moduleId)!, child, childPosts, id));
  return entry;
}

async function validateConsumableBalances(database: Transaction, before: LedgerPosting[], after: LedgerPosting[]) {
  const changes = new Map<string, { type: string; id: string; quantity: Prisma.Decimal }>();
  for (const [posts, sign] of [[before, -1], [after, 1]] as const) for (const post of posts) {
    if (post.entityType !== "loyalty" && !(post.entityType === "product" && post.entityId.startsWith("gift:"))) continue;
    const key = `${post.entityType}:${post.entityId}`, row = changes.get(key) || { type: post.entityType, id: post.entityId, quantity: quantity(0) };
    row.quantity = row.quantity.add(quantity(post.quantity || 0).mul(sign)); changes.set(key, row);
  }
  for (const change of changes.values()) {
    if (change.quantity.gte(0)) continue;
    const current = await database.bunkBookLedger.aggregate({ where: { entityType: change.type, entityId: change.id, entry: { status: { not: "void" } } }, _sum: { quantity: true } });
    if (quantity(current._sum.quantity || 0).add(change.quantity).lt(0)) throw new BunkBookError(change.type === "loyalty" ? "Reverse the guest's gift redemptions before reducing earned points." : "Reverse issued gifts before reducing their purchased stock.", 409);
  }
}

export async function executeAction(actor: BunkBookActor, input: ActionInput) {
  const selectedModule = moduleById.get(input.module);
  if (!selectedModule) throw new BunkBookError("Choose a valid BunkBook module.", 404);
  let moduleSchema: ModuleSchema = selectedModule;
  const operation = input.operation || "save";
  const permission = operation === "save" ? input.id || moduleSchema.kind === "settings" ? "edit" : "create" : operation === "generate" ? "create" : operation === "pay" || operation === "reset-bills" ? "edit" : operation.startsWith("preview") ? "view" : operation;
  if (!hasPermission(actor, moduleSchema.id, permission)) throw new BunkBookError("Your role does not have permission to perform this action.", 403);
  let fields = Object.fromEntries(Object.entries(jsonFields(input.fields)).filter(([key]) => !key.startsWith("_") || key === "_date"));
  let originalFields: BunkBookFields | undefined;
  if (operation === "filter" || operation === "report") return { module: moduleSchema.id, filters: fields };
  return transaction(async database => {
    const save = async (moduleId: string, row: NormalizedRow, posts: LedgerPosting[] = [], id?: string) => {
      const schema = moduleById.get(moduleId);
      if (!schema) throw new BunkBookError("Unknown record type.");
      return saveEntry(database, actor, schema, row, posts, id);
    };
    if (["sale-invoices", "statements", "brs-generation", "vrs-generation"].includes(moduleSchema.id) && ["save", "generate"].includes(operation)) {
      const result = await generateDocuments(database, actor, moduleSchema.id, fields, input.ids || [], save);
      if (result) return result;
    }
    if (["delete", "toggle", "reconcile"].includes(operation)) {
      const ids = input.ids?.length ? input.ids : input.id ? [input.id] : [];
      if (!ids.length) throw new BunkBookError("Select at least one entry.");
      const entries = await database.bunkBookEntry.findMany({ where: { module: moduleSchema.id, id: { in: ids }, status: { not: "void" } } });
      if (entries.length !== ids.length) throw new BunkBookError("One or more entries do not belong to this station.", 404);
      for (const entry of entries) {
        assertGovernmentDocumentUnlocked(entry.module, jsonFields(entry.fields));
        const parent = await sourceParent(database, entry);
        if (parent && ["vendor-transactions", "business-transactions"].includes(entry.module)) throw new BunkBookError("Change this posting through its original transaction so all related balances stay together.", 409);
        if (operation === "delete") {
          const dependency = await bowserDependency(database, entry);
          if (dependency) throw new BunkBookError(dependency, 409);
          if (fieldValue(jsonFields(entry.fields), "invoice_id")) throw new BunkBookError("Cancel this sale's generated invoice before changing the sale.", 409);
          if (moduleSchema.id === "generated-invoices") {
            const sources = await database.bunkBookEntry.findMany({ where: { fields: { path: ["invoice_id"], equals: entry.id } } });
            for (const source of sources) { const fields = jsonFields(source.fields); delete fields.invoice_id; delete fields.invoice_number; await database.bunkBookEntry.update({ where: { id: source.id }, data: { fields: safeFields(fields) } }); }
          }
          if (moduleSchema.id === "opening-stock") {
            const tank = fieldValue(jsonFields(entry.fields), "tank_no"), recalculated = await stockAt(database, tank, entry.date, entry.id);
            await shiftStockSnapshots(database, tank, entry.date, recalculated.sub(fieldValue(jsonFields(entry.fields), "close_stock", "0")), entry.id);
          }
          if (moduleSchema.id === "interest" && jsonFields(entry.fields).type === "Loan" && await database.bunkBookEntry.count({ where: { module: "interest", status: { not: "void" }, fields: { path: ["loan_id"], equals: entry.id } } })) throw new BunkBookError("Reverse this loan's repayments before deleting the loan.", 409);
          if (moduleSchema.id === "users") {
            const username = fieldValue(jsonFields(entry.fields), ["username", "user_name"], entry.name);
            await protectUser(database, actor, username, true);
            const account = await database.bunkBookUser.findUnique({ where: { username } });
            if (account) { await database.bunkBookSession.deleteMany({ where: { userId: account.id } }); await database.bunkBookUser.update({ where: { id: account.id }, data: { active: false } }); }
          }
          if (moduleSchema.kind === "master") {
            const types: Record<string, string[]> = { customers: ["customer"], vendors: ["vendor"], employees: ["employee", "employee-advance"], "swipe-machines": ["swipe"], "business-parties": ["bank", "party"], "fuel-products": ["product"], lubricants: ["product"], gifts: ["product"] };
            const type = types[moduleSchema!.id] || [];
            const externalId = `${moduleSchema!.id === "lubricants" ? "lub:" : moduleSchema!.id === "gifts" ? "gift:" : ""}${entry.externalId || String(entry.number)}`;
            const linked = type.length ? await database.bunkBookLedger.count({ where: { entityType: { in: type }, entityId: externalId, entry: { id: { not: entry.id }, status: { not: "void" } } } }) : 0;
            if (linked || await hasMasterReferences(database, entry)) throw new BunkBookError("This master is used by existing transactions. Deactivate it to keep its history.", 409);
          }
          const posts = await database.bunkBookLedger.findMany({ where: { entryId: entry.id } });
          await validateConsumableBalances(database, posts, []);
          const cashChange = moduleSchema.id === "settlements" ? (await cashAt(database, entry.date, false, entry.id)).sub(entry.amount) : cashMovement(posts).neg();
          await adjustCashSnapshots(database, entry.date, cashChange, entry.id, moduleSchema.id === "settlements");
          await removeLinkedEntries(database, entry);
          await adjustStockSnapshots(database, entry.date, posts, []);
          await database.bunkBookLedger.deleteMany({ where: { entryId: entry.id } });
          await database.bunkBookEntry.update({ where: { id: entry.id }, data: { status: "void" } });
          if (moduleSchema.id === "interest" && fieldValue(jsonFields(entry.fields), "loan_id")) await refreshLoan(database, fieldValue(jsonFields(entry.fields), "loan_id"));
        } else if (operation === "toggle") {
          if (moduleSchema!.id === "users" && fieldValue(jsonFields(entry.fields), ["user_name", "username"], entry.name) === actor.username) throw new BunkBookError("You cannot deactivate your own account.");
          const status = entry.status === "active" ? "inactive" : "active";
          if (moduleSchema.id === "users") await protectUser(database, actor, fieldValue(jsonFields(entry.fields), ["username", "user_name"], entry.name), status === "inactive");
          await database.bunkBookEntry.update({ where: { id: entry.id }, data: { status } });
          if (moduleSchema.id === "users") {
            const username = fieldValue(jsonFields(entry.fields), ["username", "user_name"], entry.name), account = await database.bunkBookUser.findUnique({ where: { username } });
            if (!account && status === "active") throw new BunkBookError("Set a local password before activating this user's login.");
            await database.bunkBookUser.updateMany({ where: { username }, data: { active: status === "active" } });
            if (account && status === "inactive") await database.bunkBookSession.deleteMany({ where: { userId: account.id } });
          }
        } else {
          await database.bunkBookEntry.update({ where: { id: entry.id }, data: { fields: safeFields({ ...jsonFields(entry.fields), reconciled: true, reconciled_date: today().toISOString().slice(0, 10) }) } });
        }
        await audit(database, actor, moduleSchema.id, operation.toUpperCase(), entry.id, { fields: entry.fields, amount: entry.amount });
      }
      return { message: operation === "delete" ? "Selected entries deleted and their balances updated." : operation === "toggle" ? "Status updated." : "Transactions reconciled.", count: entries.length };
    }
    if (moduleSchema.id === "password") {
      const current = fieldValue(fields, ["oldPwd", "current_password", "old_password", "old_pwd", "old_pass", "password"]);
      const next = fieldValue(fields, ["newPwd", "new_password", "new_pwd", "new_pass", "newpassword"]);
      const repeat = fieldValue(fields, ["conPwd", "confirm_password", "confirm_pwd", "re_password", "renew_pwd", "re_new_pass"]);
      if (!verifyPassword(current, actor.passwordHash)) throw new BunkBookError("Your current password is incorrect.");
      if (!next || next.length < 4) throw new BunkBookError("Enter a new password with at least four characters.");
      if (next !== repeat) throw new BunkBookError("The new passwords do not match.");
      await database.bunkBookUser.update({ where: { id: actor.id }, data: { passwordHash: hashPassword(next) } });
      await database.bunkBookSession.deleteMany({ where: { userId: actor.id } });
      await audit(database, actor, moduleSchema.id, "PASSWORD_CHANGED");
      return { message: "Password changed. Sign in with your new password.", redirect: "/bunkbook/login" };
    }
    if (moduleSchema.id === "settings" && operation === "reset-bills") {
      await database.bunkBookSequence.upsert({ where: { module: "credit-bill" }, create: { module: "credit-bill", value: 0 }, update: { value: 0 } });
      await audit(database, actor, "settings", "BILL_SEQUENCE_RESET");
      return { message: "The next credit bill number is reset to 1." };
    }
    if (["organization", "settings", "print-templates"].includes(moduleSchema.id)) {
      const previous = jsonFields(actor.station.settings);
      const featureIds = moduleSchema.id === "settings" ? (Array.isArray(fields["page_id[]"]) ? fields["page_id[]"].map(String) : []) : Array.isArray(previous.feature_ids) ? previous.feature_ids.map(String) : [];
      const settings = safeFields({ ...previous, ...fields, ...(moduleSchema.id === "settings" ? { feature_ids: featureIds, purchase_policy: {
        lfr_tot: featureIds?.includes("1") ? "yes" : "no", delar_comm: featureIds?.includes("2") ? "yes" : "no", lfr_incl: featureIds?.includes("3") ? "yes" : "no", del_incl: featureIds?.includes("24") ? "yes" : "no", lfr_other: featureIds?.includes("35") ? "yes" : "no",
      } } : {}) });
      await database.bunkBookStation.update({ where: { id: "station" }, data: { settings,
        ...(moduleSchema.id === "organization" && fieldValue(fields, "company_name") ? { name: fieldValue(fields, "company_name") } : {}) } });
      await audit(database, actor, moduleSchema.id, "SETTINGS_UPDATED", undefined, safeFields(previous), safeFields(fields));
      return { message: "Settings saved." };
    }
    if (moduleSchema.id === "roles" && fields.permissions !== undefined && !Array.isArray(fields.permissions)) throw new BunkBookError("Choose valid role permissions.");
    const originalSchema = formFor(moduleSchema, input.formIndex, input.action);
    if (/save_advance/.test(originalSchema?.action || input.action || "")) {
      moduleSchema = moduleById.get("recoveries")!;
      fields = { ...fields, insert_date: fieldValue(fields, "date_input"), rec_organiz: fieldValue(fields, "org_input"), paid_amt: fieldValue(fields, "adv_input"), rec_emp: fieldValue(fields, "employeeName"), re_type: fieldValue(fields, "mode", "Cash"), rec_desc: fieldValue(fields, "description"), advance: true };
    }
    if (moduleSchema.id === "shift-sheet") { moduleSchema = moduleById.get("daily-rates")!; fields = { ...fields, _upsertRates: true }; }
    if (/purchase/.test(moduleSchema.id) || moduleSchema.id === "lfr-invoices") {
      const invoiceNumber = fieldValue(fields, ["invo_no", "invoiceno", "invoice_no", "invoice_number"]);
      if (invoiceNumber) fields.invo_no = invoiceNumber;
    }
    if (input.id) {
      const previous = await database.bunkBookEntry.findFirst({ where: { id: input.id, module: moduleSchema.id, status: { not: "void" } } });
      if (!previous) throw new BunkBookError("This entry does not belong to this station.", 404);
      const dependency = await bowserDependency(database, previous);
      if (dependency) throw new BunkBookError(dependency, 409);
      assertGovernmentDocumentUnlocked(previous.module, jsonFields(previous.fields));
      if (fieldValue(jsonFields(previous.fields), "invoice_id")) throw new BunkBookError("Cancel this sale's generated invoice before editing the sale.", 409);
      const parent = await sourceParent(database, previous);
      if (parent && ["vendor-transactions", "business-transactions"].includes(previous.module)) throw new BunkBookError("Edit this posting through its original transaction.", 409);
      const inherited = jsonFields(previous.fields); delete inherited._date;
      originalFields = jsonFields(previous.fields);
      fields = { ...inherited, ...fields };
    }
    const custom = await domainAction(database, actor, moduleSchema.id, operation, fields, input.id, save);
    if (custom !== undefined) return custom;
    if (moduleSchema.id === "roles") {
      const offered = Array.isArray(fields.permissions) ? fields.permissions.map(String) : Array.isArray(fields.page_ids) ? permissionsForPages(fields.page_ids) : [];
      const known = new Set(Object.values(rolePages));
      if (offered.some(value => value !== "*" && !known.has(value) && !moduleById.has(value))) throw new BunkBookError("Choose valid role permissions.");
      if (!Array.isArray(actor.permissions) || !actor.permissions.includes("*")) for (const value of offered) {
        const [target, action] = value.split(":");
        if (value === "*" || !hasPermission(actor, target, action || "view")) throw new BunkBookError("You can grant only permissions that your own role has.", 403);
      }
      fields.permissions = offered; fields.page_ids = pagesForPermissions(offered);
      if (input.id) {
        const previous = await database.bunkBookEntry.findUnique({ where: { id: input.id } });
        if (previous) {
          const users = await database.bunkBookUser.findMany({ where: { role: previous.name } });
          if (!offered.includes("*") && users.some(user => user.active && Array.isArray(user.permissions) && user.permissions.includes("*"))) {
            const otherAdmins = await database.bunkBookUser.count({ where: { active: true, role: { not: previous.name }, permissions: { array_contains: ["*"] } } });
            if (!otherAdmins) throw new BunkBookError("Keep at least one active Super Admin role.", 409);
          }
          await database.bunkBookUser.updateMany({ where: { role: previous.name }, data: { role: fieldValue(fields, "role_name", previous.name), permissions: offered } });
        }
      }
    }
    const schema = formFor(moduleSchema, input.formIndex, input.action);
    const rows = rowsFromForm(moduleSchema, fields);
    if (!(moduleSchema.id === "daily-rates" && input.id)) {
      if (Array.isArray(fields.rows)) for (const row of rows) validateSchema(moduleSchema, schema?.index, row, Boolean(input.id));
      else validateSchema(moduleSchema, schema?.index, fields, Boolean(input.id));
    }
    if (!rows.length) throw new BunkBookError("Enter at least one row before saving.");
    if (input.id && rows.length > 1 && !/purchase/.test(moduleSchema.id)) throw new BunkBookError("Edit one transaction at a time.");
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
      await validateMasterReferences(database, moduleSchema.id, enriched, originalFields);
      if (moduleSchema.id === "bowser-sales") enriched = await prepareBowserSale(database, enriched, approximateDate, jsonFields(actor.station.settings), input.id);
      if (/purchase/.test(moduleSchema.id)) enriched._purchase_policy = { delar_comm: "no", lfr_tot: "no", lfr_incl: "no", del_incl: "no", ...jsonFields(jsonFields(actor.station.settings).purchase_policy) };
      const row = normalizeRow(moduleSchema, enriched);
      await validateEntryUniqueness(database, moduleSchema, row, seen, input.id);
      if (baseModule(moduleSchema.id) === "guest-sales") row.fields.points = (await earnedPoints(database, actor, row.fields, row.quantity)).toString();
      if (jsonFields(actor.station.settings).date_ctl === "yes" && moduleSchema.kind === "transaction" && moduleSchema.id !== "settlements") {
        const closed = await database.bunkBookEntry.count({ where: { module: "settlements", date: row.date, status: { not: "void" } } });
        if (closed) throw new BunkBookError("This date is settled. Unlock settled dates in Organization Details before changing its transactions.", 409);
      }
      if (moduleSchema.id === "daily-rates") {
        const duplicate = await database.bunkBookEntry.findFirst({ where: { module: "daily-rates", date: row.date, status: { not: "void" }, ...(input.id ? { id: { not: input.id } } : {}), fields: { path: ["product"], equals: fieldValue(row.fields, PRODUCT_KEYS) } } });
        if (duplicate && (input.id || !fields._upsertRates)) throw new BunkBookError("A sale rate already exists for this product and date. Edit the existing rate.", 409);
        if (duplicate && fields._upsertRates) { normalized.push({ row, posts: [], existingId: duplicate.id }); continue; }
      }
      if (moduleSchema.id === "users") { const user = await saveUser(database, actor, enriched, input.id); row.fields.auth_user_id = user.id; }
      const posts = ledgerFor(moduleSchema, row);
      if (baseModule(moduleSchema.id) === "credit-sales") {
        const customer = await entity(database, "customers", fieldValue(row.fields, CUSTOMER_KEYS));
        const limit = fieldNumber(jsonFields(customer?.fields), "credit_limit");
        if (limit > 0 && jsonFields(actor.station.settings).credit_limit === "yes") {
          const ledger = await database.bunkBookLedger.findMany({ where: { entityType: "customer", entityId: customer?.externalId || "", entry: { status: { not: "void" }, ...(input.id ? { id: { not: input.id } } : {}) } } });
          const balance = ledger.reduce((sum, entry) => sum.add(entry.debit).sub(entry.credit), money(0));
          const key = customer!.externalId || customer!.id, batch = (saleTotals.get(key) || money(0)).add(row.amount); saleTotals.set(key, batch);
          if (balance.add(batch).gt(limit)) throw new BunkBookError("This sale would exceed the customer's credit limit.", 409);
        }
      }
      normalized.push({ row, posts });
    }
    if (/purchase/.test(moduleSchema.id) || moduleSchema.id === "lfr-invoices") {
      const invoiceNumber = fieldValue(fields, ["invo_no", "invoice_no", "invoice_number"]);
      if (invoiceNumber) {
        const duplicate = await database.bunkBookEntry.findFirst({ where: { module: moduleSchema.id, status: { not: "void" }, ...(input.id ? { id: { not: input.id } } : {}), OR: ["invo_no", "invoiceno", "invoice_no", "invoice_number"].map(key => ({ fields: { path: [key], equals: invoiceNumber } })) } });
        if (duplicate) throw new BunkBookError("This invoice number is already recorded.", 409);
      }
      if (normalized.length >= 1) {
        const amount = normalized.reduce((total, item) => total.add(item.row.amount), money(0));
        const count = normalized.reduce((total, item) => total.add(item.row.quantity), quantity(0));
        const aggregate = normalized[0].row;
        const items = normalized.map(item => ({ ...safeFields({ ...item.row.fields, items: undefined }), amount: item.row.amount.toString(), quantity: item.row.quantity.toString(), rate: item.row.rate.toString() }));
        const rounding = money(fieldValue(fields, ["roundingoff", "roundoff"], "0")), dealer = moduleSchema.id === "fuel-purchases" ? normalized.reduce((sum, item) => sum.add(fieldValue(item.row.fields, "dealercomm", "0")), money(0)) : money(0), cashDiscount = money(fieldValue(fields, "cashdisc", "0"));
        const dealerAlreadyDeducted = jsonFields(jsonFields(actor.station.settings).purchase_policy).delar_comm === "yes" ? dealer : money(0);
        const total = money(amount.add(rounding).add(dealerAlreadyDeducted).sub(dealer).sub(cashDiscount));
        if (total.lte(0)) throw new BunkBookError("Invoice total must be a positive amount.");
        const invoiceFields = { ...fields, ...aggregate.fields, items, payment_amnt: fieldValue(fields, "Payment") || !moduleSchema.forms.some(form => form.fields.some(field => field.name === "Payment")) ? fieldValue(fields, "payment_amnt", "0") : "0", total_amount: total.toString(), _batch: randomUUID() };
        if (money(invoiceFields.payment_amnt).gt(total)) throw new BunkBookError("Payment cannot exceed the invoice total.");
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

export async function saveGenerated(actor: BunkBookActor, moduleId: string, fields: BunkBookFields, amount: unknown, name: string) {
  const moduleSchema = moduleById.get(moduleId);
  if (!moduleSchema || !hasPermission(actor, moduleId, "edit")) throw new BunkBookError("Your role cannot generate this record.", 403);
  return transaction(async database => saveEntry(database, actor, moduleSchema, { name, date: today(), amount: money(amount), quantity: quantity(0), rate: quantity(0), fields, status: "active" }, []));
}
