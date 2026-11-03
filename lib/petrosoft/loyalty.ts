import { Prisma, type PetrosoftEntry } from "@prisma/client";
import { fieldValue, jsonFields, type PetrosoftFields } from "./catalog";
import { money, positive, quantity, safeFields, type NormalizedRow, type LedgerPosting } from "./rules";
import type { PetrosoftActor } from "./auth";

type Database = Prisma.TransactionClient;
type Save = (module: string, row: NormalizedRow, posts?: LedgerPosting[], id?: string) => Promise<PetrosoftEntry>;

export async function prepareGuest(database: Database, actor: PetrosoftActor, fields: PetrosoftFields, date: Date, save: Save) {
  const id = fieldValue(fields, "guest_id"), phone = fieldValue(fields, ["mobileno", "g_number", "mobile"]), name = fieldValue(fields, ["gname", "g_name", "guest_name"]);
  let guest = id ? await database.petrosoftEntry.findFirst({ where: { workspaceId: actor.workspaceId, module: "guests", status: "active", OR: [{ id }, { externalId: id }] } }) : null;
  if (id && !guest) throw new Error("Choose a guest from this station.");
  if (!guest && phone) guest = await database.petrosoftEntry.findFirst({ where: { workspaceId: actor.workspaceId, module: "guests", status: "active", OR: [{ fields: { path: ["g_number"], equals: phone } }, { fields: { path: ["g_mobileno"], equals: phone } }] } });
  if (!guest) {
    if (!name.trim() || !phone.trim()) throw new Error("Enter the guest name and mobile number.");
    guest = await save("guests", { name: name.trim(), date, amount: money(0), quantity: quantity(0), rate: quantity(0), status: "active", fields: { g_name: name.trim(), g_number: phone.trim(), g_date: date.toISOString().slice(0, 10), vehicle_no: fieldValue(fields, "vehi_no") } }, []);
  }
  const identity = guest.externalId || String(guest.number);
  return { ...fields, guest_id: identity, customer_id: identity, gname: guest.name, mobileno: fieldValue(jsonFields(guest.fields), ["g_number", "g_mobileno"], phone) };
}

export async function earnedPoints(database: Database, actor: PetrosoftActor, fields: PetrosoftFields, count: Prisma.Decimal) {
  const [configs, tiers, ledger] = await Promise.all([
    database.petrosoftEntry.findMany({ where: { workspaceId: actor.workspaceId, module: "loyalty-points", status: "active" } }),
    database.petrosoftEntry.findMany({ where: { workspaceId: actor.workspaceId, module: "loyalty-tiers", status: "active" } }),
    database.petrosoftLedger.findMany({ where: { entityType: "loyalty", entityId: fieldValue(fields, ["guest_id", "customer_id"]), quantity: { gt: 0 }, entry: { workspaceId: actor.workspaceId, status: { not: "void" } } } }),
  ]);
  const lifetime = ledger.reduce((sum, post) => sum.add(post.quantity), quantity(0));
  const achieved = tiers.filter(tier => lifetime.gte(fieldValue(jsonFields(tier.fields), ["points_rate", "points_needed"], "0"))).sort((a, b) => Number(fieldValue(jsonFields(b.fields), ["points_rate", "points_needed"], "0")) - Number(fieldValue(jsonFields(a.fields), ["points_rate", "points_needed"], "0")));
  const tier = achieved[0], tierName = tier?.name || "Regular", tierId = tier?.externalId || "Regular", product = fieldValue(fields, "product");
  const matches = configs.filter(config => {
    const f = jsonFields(config.fields), configured = fieldValue(f, "tier_name", "Regular");
    return [tierName, tierId].includes(configured) && (!fieldValue(f, ["prod_id", "product"]) || ["0", "all"].includes(fieldValue(f, ["prod_id", "product"])) || fieldValue(f, ["prod_id", "product"]) === product);
  });
  const config = matches.find(config => fieldValue(jsonFields(config.fields), ["prod_id", "product"]) === product) || matches[0];
  const start = quantity(fieldValue(jsonFields(actor.workspace.settings), ["start_qty", "ponits_start"], "0"));
  if (!config || count.lt(start)) return quantity(0);
  return quantity(count.mul(positive(fieldValue(jsonFields(config.fields), ["points_rate", "points_per_qty"], "0"), "Points per quantity", true)));
}

export async function validateRedemption(database: Database, actor: PetrosoftActor, fields: PetrosoftFields, id?: string, consumed = new Map<string, Prisma.Decimal>()) {
  const guest = fieldValue(fields, ["guest_cust", "guest_id", "customer_id"]), giftId = fieldValue(fields, ["gifts", "product"]);
  const gift = await database.petrosoftEntry.findFirst({ where: { workspaceId: actor.workspaceId, module: "gifts", status: "active", externalId: giftId } });
  if (!gift) throw new Error("Choose an active gift from this station.");
  const points = positive(fieldValue(jsonFields(gift.fields), ["emp_no", "points"], "0"), "Gift points", true);
  const ledger = await database.petrosoftLedger.groupBy({ by: ["entityType", "entityId"], where: { OR: [{ entityType: "loyalty", entityId: guest }, { entityType: "product", entityId: `gift:${giftId}` }], entry: { workspaceId: actor.workspaceId, status: { not: "void" }, ...(id ? { id: { not: id } } : {}) } }, _sum: { quantity: true } });
  const balance = quantity(ledger.find(post => post.entityType === "loyalty")?._sum.quantity || 0), stock = quantity(ledger.find(post => post.entityType === "product")?._sum.quantity || 0);
  const usedPoints = (consumed.get(`guest:${guest}`) || quantity(0)).add(points), usedStock = (consumed.get(`gift:${giftId}`) || quantity(0)).add(1);
  if (balance.lt(usedPoints)) throw new Error("The guest does not have enough points for this gift.");
  if (stock.lt(usedStock)) throw new Error("This gift is out of stock. Record its purchase before issuing it.");
  consumed.set(`guest:${guest}`, usedPoints); consumed.set(`gift:${giftId}`, usedStock);
  return safeFields({ ...fields, guest_cust: guest, customer_id: guest, gifts: giftId, product: giftId, points: points.toString(), quantity: "1" });
}
