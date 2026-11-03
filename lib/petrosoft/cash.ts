import { Prisma } from "@prisma/client";
import { fieldValue, jsonFields } from "./catalog";
import { money } from "./rules";
import { safeFields, type LedgerPosting } from "./rules";

export async function cashAt(database: Prisma.TransactionClient, workspaceId: string, asOf: Date, before = false, excluding?: string) {
  const date = before ? { lt: asOf } : { lte: asOf };
  const snapshot = await database.petrosoftEntry.findFirst({ where: { workspaceId, module: "settlements", date, status: { not: "void" }, ...(excluding ? { id: { not: excluding } } : {}) }, orderBy: [{ date: "desc" }, { number: "desc" }] });
  const movements = await database.petrosoftLedger.aggregate({ where: { entityType: "cash", entityId: "cash", date: { ...date, ...(snapshot ? { gt: snapshot.date } : {}) }, entry: { workspaceId, status: { not: "void" }, ...(excluding ? { id: { not: excluding } } : {}) } }, _sum: { debit: true, credit: true } });
  const opening = snapshot ? money(fieldValue(jsonFields(snapshot.fields), ["closecash", "close_bal"], snapshot.amount.toString())) : money(0);
  return money(opening.add(movements._sum.debit || 0).sub(movements._sum.credit || 0));
}

export function cashMovement(posts: LedgerPosting[]) {
  return posts.filter(post => post.entityType === "cash" && post.entityId === "cash").reduce((sum, post) => sum.add(money(post.debit || 0)).sub(money(post.credit || 0)), money(0));
}

export async function adjustCashSnapshots(database: Prisma.TransactionClient, workspaceId: string, date: Date, change: Prisma.Decimal, excluding?: string, settlement = false) {
  if (change.isZero()) return;
  const snapshots = await database.petrosoftEntry.findMany({ where: { workspaceId, module: "settlements", date: { gte: date }, status: { not: "void" }, ...(excluding ? { id: { not: excluding } } : {}) } });
  for (const snapshot of snapshots) {
    const f = jsonFields(snapshot.fields), sameDay = snapshot.date.getTime() === date.getTime();
    const opening = money(fieldValue(f, ["opencash", "open_bal"], "0")).add(sameDay ? 0 : change);
    const closing = money(fieldValue(f, ["closecash", "close_bal"], snapshot.amount.toString())).add(change);
    const net = money(fieldValue(f, ["finialbankamt", "final_stle"], "0")).add(sameDay && !settlement ? change : 0);
    await database.petrosoftEntry.update({ where: { id: snapshot.id }, data: { amount: closing, fields: safeFields({ ...f, opencash: opening.toString(), closecash: closing.toString(), finialbankamt: net.toString() }) } });
  }
}
