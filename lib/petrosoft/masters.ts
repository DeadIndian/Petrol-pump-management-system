import { Prisma, type PetrosoftEntry } from "@prisma/client";
import { fieldValue, jsonFields, type PetrosoftFields } from "./catalog";
import { baseModule, CUSTOMER_KEYS, EMPLOYEE_KEYS, paymentAccount, PRODUCT_KEYS, referenceValue, VENDOR_KEYS } from "./rules";

type Database = Prisma.TransactionClient;
export async function referencedMaster(database: Database, workspaceId: string, module: string, offered: unknown, active = false) {
  const id = String(offered || "").split("|")[0];
  if (!id || ["0", "all", "unassigned"].includes(id.toLowerCase())) return null;
  return database.petrosoftEntry.findFirst({ where: { workspaceId, module, status: active ? "active" : { not: "void" }, OR: [{ id }, { externalId: id }, { name: { equals: id, mode: "insensitive" } }] } });
}
export async function validateMasterReferences(database: Database, workspaceId: string, module: string, fields: PetrosoftFields, previous?: PetrosoftFields) {
  const base = baseModule(module), guest = ["guest-sales", "gift-sales", "loyalty-transactions"].includes(base);
  const relations: [string, string[], boolean][] = [];
  if (["meter-sales", "credit-sales", "guest-sales", "handling-loss", "fuel-purchases", "lubricant-purchases", "lubricant-sales", "lubricant-loss", "gift-purchases", "gift-sales", "other-purchases", "loyalty-points", "tanks"].includes(base)) {
    const type = /lubricant/.test(base) || base === "other-purchases" ? "lubricants" : /gift/.test(base) ? "gifts" : "fuel-products";
    relations.push([type, PRODUCT_KEYS, true]);
  }
  if (["credit-sales", "recoveries"].includes(base) || base === "lubricant-sales" && /credit/i.test(fieldValue(fields, ["sale_type1", "sale_type"]))) relations.push(["customers", CUSTOMER_KEYS, true]);
  if (guest) relations.push(["guests", base === "gift-sales" ? ["guest_cust", "guest_id", "customer_id"] : ["guest_id", "customer_id"], true]);
  if (["fuel-purchases", "lubricant-purchases", "other-purchases", "lfr-invoices", "gift-purchases", "vendor-transactions"].includes(base)) relations.push(["vendors", VENDOR_KEYS, true]);
  if (["credit-sales", "meter-sales", "swipes", "expenses", "recoveries", "employee-recoveries", "lubricant-sales", "guest-sales", "day-assignments", "users"].includes(base)) relations.push(["employees", EMPLOYEE_KEYS, base === "employee-recoveries"]);
  if (base === "swipes") relations.push(["swipe-machines", ["swipe_name", "swipe_bank", "swp_name"], true]);
  if (base === "pump-settings") relations.push(["nozzles", ["noz", "nozzle_id"], true]);
  if (base === "loyalty-points") relations.push(["loyalty-tiers", ["tier_name"], true]);
  if (base === "users") relations.push(["roles", ["role", "user_role"], true]);
  for (const [type, keys, required] of relations) {
    const value = referenceValue(fields, keys);
    if (!value && !required) continue;
    if (type === "loyalty-tiers" && value === "Regular") continue;
    const unchanged = previous && referenceValue(previous, keys) === value;
    const master = await referencedMaster(database, workspaceId, type, value, !unchanged);
    if (!master) throw new Error(`Choose an active ${type.replace(/-/g, " ")} entry from this station.`);
  }
  const tank = referenceValue(fields, ["tank_no", "stock_tank"]);
  if (tank && ["meter-sales", "pump-settings", "nozzles", "sales-officer", "tanker-sales", "fuel-purchases"].includes(base)) {
    const unchanged = previous && referenceValue(previous, ["tank_no", "stock_tank"]) === tank;
    const master = await database.petrosoftEntry.findFirst({ where: { workspaceId, module: "tanks", status: unchanged ? { not: "void" } : "active", OR: [{ id: tank }, { externalId: tank }, { fields: { path: ["tank_no"], equals: tank } }] } });
    if (!master) throw new Error("Choose an active tank from this station.");
    const expected = fieldValue(jsonFields(master.fields), ["product", "pro_name"]), product = referenceValue(fields, PRODUCT_KEYS);
    if (product && expected && product !== expected) throw new Error("The selected product does not belong to this tank.");
    fields.tank_no = fieldValue(jsonFields(master.fields), "tank_no", master.externalId || String(master.number));
    if (["pump-settings", "nozzles"].includes(base)) fields.product = expected;
  }
  if (["meter-sales", "pump-settings"].includes(module)) {
    const nozzleId = referenceValue(fields, ["nozzle_id", "nozzle", "noz", "nozzel_id"]);
    const nozzle = await referencedMaster(database, workspaceId, "nozzles", nozzleId, !previous);
    if (!nozzle) throw new Error("Choose an active nozzle from this station.");
    const n = jsonFields(nozzle.fields), tankNo = fieldValue(n, "tank_no"), product = fieldValue(n, "product");
    if (tankNo !== fieldValue(fields, "tank_no")) throw new Error("The selected nozzle does not belong to this tank.");
    if (product && referenceValue(fields, PRODUCT_KEYS) && product !== referenceValue(fields, PRODUCT_KEYS)) throw new Error("The selected product does not belong to this nozzle.");
    if (module === "meter-sales") {
      const pump = await referencedMaster(database, workspaceId, "pump-settings", fieldValue(fields, "pump_id"), !previous);
      if (!pump || fieldValue(jsonFields(pump.fields), ["noz", "nozzel_id"]) !== (nozzle.externalId || String(nozzle.number))) throw new Error("Choose the pump assigned to this nozzle.");
      fields.nozzle_id = nozzle.externalId || String(nozzle.number); fields.nozzle = fields.nozzle_id;
    } else fields.noz = nozzle.externalId || String(nozzle.number);
  }
  if (["recoveries", "expenses", "vendor-transactions"].includes(base)) {
    const account = paymentAccount(fields);
    if (account.type !== "cash") {
      const type = account.type === "bank" || account.type === "party" ? "business-parties" : account.type === "vendor" ? "vendors" : "swipe-machines";
      const master = await referencedMaster(database, workspaceId, type, account.id, !previous);
      if (!master || account.type === "bank" && !/bank/i.test(fieldValue(jsonFields(master.fields), "p_type"))) throw new Error(`Choose a valid ${account.type} account from this station.`);
    }
  }
  if (base === "business-transactions") {
    for (const key of ["partytype", "Topartytype"]) {
      const offered = fieldValue(fields, key), id = offered.split("|")[0];
      if (/^cash$/i.test(id)) { fields[key] = "cash|Cash"; continue; }
      const party = await referencedMaster(database, workspaceId, "business-parties", id, !previous);
      if (!party) throw new Error("Choose both transfer accounts from this station.");
      fields[key] = `${party.externalId || party.number}|${fieldValue(jsonFields(party.fields), "p_type", "Creditor")}`;
    }
  }
  if (fieldValue(fields, "payment_amnt") && fieldValue(fields, "payment_bank")) {
    const bank = await referencedMaster(database, workspaceId, "business-parties", fieldValue(fields, "payment_bank"), !previous);
    if (!bank || !/bank/i.test(fieldValue(jsonFields(bank.fields), "p_type"))) throw new Error("Choose a bank account from this station for the purchase payment.");
  }
}

const references: Record<string, string[]> = {
  customers: [...CUSTOMER_KEYS, "customer_id"], vendors: VENDOR_KEYS, employees: [...EMPLOYEE_KEYS, "pay_emply", "user_empid"],
  "fuel-products": PRODUCT_KEYS, lubricants: PRODUCT_KEYS, gifts: ["gifts", "gift_id", "product"],
  tanks: ["tank_no", "stock_tank", "tank_id"], nozzles: ["noz", "nozzle", "nozzle_id", "nozzel_id"],
  "swipe-machines": ["swipe_bank", "swipe_name", "attach_swipe"], "business-parties": ["bank_id", "crd_id", "partytype", "Topartytype", "payment_bank", "bank", "attach_bank"],
  roles: ["role", "user_role"], "duty-shifts": ["emp_shift", "shift"], "business-shifts": ["shift"],
  "expiry-categories": ["cat_id"], "expiry-items": ["item_id"], "loyalty-tiers": ["tier_name", "tier_id"],
};
export async function hasMasterReferences(database: Database, entry: Pick<PetrosoftEntry, "id" | "module" | "workspaceId" | "externalId" | "number" | "name" | "fields">) {
  const keys = references[entry.module];
  if (!keys) return false;
  const identity = entry.externalId || String(entry.number), f = jsonFields(entry.fields);
  const values = [...new Set([identity, entry.id, ...(entry.module === "tanks" ? [fieldValue(f, "tank_no")] : []), ...(["roles", "duty-shifts", "business-shifts"].includes(entry.module) ? [entry.name] : [])])].filter(Boolean);
  // Relationships are scoped by module to avoid confusing the numeric ID of a
  // lubricant with the same ID in the fuel catalogue.
  const scope: Record<string, string[]> = {
    "fuel-products": ["tanks", "nozzles", "pump-settings", "daily-rates", "meter-sales", "credit-sales", "guest-sales", "handling-loss", "opening-stock", "loyalty-points", "customer-discounts", "fuel-purchases"],
    lubricants: ["lubricant-sales", "lubricant-purchases", "lubricant-loss", "day-assignments", "other-purchases"],
    gifts: ["gift-purchases", "gift-sales"], "duty-shifts": ["attendance-details"], "business-shifts": ["meter-sales", "credit-sales", "expenses", "swipes", "recoveries", "settlements"],
    roles: ["users"],
  };
  const reference = await database.petrosoftEntry.findFirst({ where: { workspaceId: entry.workspaceId, id: { not: entry.id }, status: { not: "void" }, ...(scope[entry.module] ? { module: { in: scope[entry.module] } } : {}),
    OR: keys.flatMap(key => values.map(value => ({ fields: { path: [key], equals: value } }))) }, select: { id: true } });
  return Boolean(reference);
}
