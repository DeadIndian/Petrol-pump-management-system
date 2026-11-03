import { Prisma } from "@prisma/client";
import { fieldValue, jsonFields } from "./catalog";
import { quantity, safeFields } from "./rules";

export async function stockAt(database: Prisma.TransactionClient, workspaceId: string, tank: string, date: Date, excluding?: string) {
  const snapshot = await database.petrosoftEntry.findFirst({ where: { workspaceId, module: "opening-stock", date: { lte: date }, status: { not: "void" }, fields: { path: ["tank_no"], equals: tank }, ...(excluding ? { id: { not: excluding } } : {}) }, orderBy: [{ date: "desc" }, { number: "desc" }] });
  const movements = await database.petrosoftLedger.aggregate({ where: { entityType: "tank", entityId: tank, date: { lte: date, ...(snapshot ? { gt: snapshot.date } : {}) }, entry: { workspaceId, status: { not: "void" }, ...(excluding ? { id: { not: excluding } } : {}) } }, _sum: { quantity: true } });
  return quantity(fieldValue(jsonFields(snapshot?.fields), ["close_stock", "closing_stock"], "0")).add(movements._sum.quantity || 0);
}

export async function shiftStockSnapshots(database: Prisma.TransactionClient, workspaceId: string, tank: string, after: Date, change: Prisma.Decimal, excluding?: string) {
  if (change.isZero()) return;
  const snapshots = await database.petrosoftEntry.findMany({ where: { workspaceId, module: "opening-stock", date: { gt: after }, status: { not: "void" }, fields: { path: ["tank_no"], equals: tank }, ...(excluding ? { id: { not: excluding } } : {}) } });
  for (const snapshot of snapshots) {
    const f = jsonFields(snapshot.fields), opening = quantity(fieldValue(f, "open_stock", "0")).add(change), closing = quantity(fieldValue(f, "close_stock", "0")).add(change);
    await database.petrosoftEntry.update({ where: { id: snapshot.id }, data: { quantity: opening, fields: safeFields({ ...f, open_stock: opening.toString(), close_stock: closing.toString(), total_stk: opening.add(fieldValue(f, "receipt", "0")).toString(), stk_variation: quantity(fieldValue(f, "dip_stock", "0")).sub(closing).toString() }) } });
  }
}
