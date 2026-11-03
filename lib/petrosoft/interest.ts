import { Prisma, type PetrosoftEntry } from "@prisma/client";
import type { PetrosoftActor } from "./auth";
import { dateValue, fieldValue, jsonFields, today, type PetrosoftFields } from "./catalog";
import { money, positive, quantity, safeFields, type LedgerPosting, type NormalizedRow } from "./rules";

type Database = Prisma.TransactionClient;
type Save = (module: string, row: NormalizedRow, posts?: LedgerPosting[], id?: string) => Promise<PetrosoftEntry>;
async function account(database: Database, actor: PetrosoftActor, offered: string) {
  const id = offered.split("|")[0];
  if (/^cash$/i.test(id)) return { id: "cash", type: "cash", name: "Cash" };
  const entry = await database.petrosoftEntry.findFirst({ where: { workspaceId: actor.workspaceId, module: "business-parties", status: "active", OR: [{ id }, { externalId: id }] } });
  if (!entry) throw new Error("Choose an active business party from this station.");
  return { id: entry.externalId || String(entry.number), type: /bank/i.test(fieldValue(jsonFields(entry.fields), "p_type")) ? "bank" : "party", name: entry.name };
}
export async function loanBalance(database: Database, actor: PetrosoftActor, loanId: string, date: Date, excluding?: string) {
  const loan = await database.petrosoftEntry.findFirst({ where: { workspaceId: actor.workspaceId, module: "interest", status: { not: "void" }, OR: [{ id: loanId }, { externalId: loanId }], fields: { path: ["type"], equals: "Loan" } } });
  if (!loan) throw new Error("Choose a loan from this station.");
  if (date < loan.date) throw new Error("A repayment cannot be dated before the loan.");
  const history = await database.petrosoftEntry.findMany({ where: { workspaceId: actor.workspaceId, module: "interest", status: { not: "void" }, fields: { path: ["loan_id"], equals: loan.id }, ...(excluding ? { id: { not: excluding } } : {}) }, orderBy: [{ date: "asc" }, { number: "asc" }] });
  const f = jsonFields(loan.fields), rate = quantity(fieldValue(f, ["interest", "interest_rate"], "0"));
  let principal = money(loan.amount), accrued = money(0), last = loan.date;
  for (const repayment of history.filter(entry => entry.date <= date)) {
    accrued = accrued.add(principal.mul(rate).div(100).mul((repayment.date.getTime() - last.getTime()) / 86400000).div(365));
    const fields = jsonFields(repayment.fields); principal = principal.sub(fieldValue(fields, "principal_repay", "0")); accrued = accrued.sub(fieldValue(fields, "interest_repay", "0")); last = repayment.date;
  }
  accrued = accrued.add(principal.mul(rate).div(100).mul((date.getTime() - last.getTime()) / 86400000).div(365));
  return { loan, principal: money(principal), interest: money(accrued), rate, repayments: history };
}
export async function interestAction(database: Database, actor: PetrosoftActor, operation: string, fields: PetrosoftFields, id: string | undefined, save: Save) {
  const date = dateValue(fieldValue(fields, ["trans_dt", "date"], today().toISOString().slice(0, 10)));
  if (operation === "preview-loan") { const data = await loanBalance(database, actor, fieldValue(fields, ["loan", "loan_id"]), date, id); return { loan_balance: data.principal.toString(), interest_payable: data.interest.toString(), interest_rate: data.rate.toString() }; }
  const selected = fieldValue(fields, ["loan", "loan_id"]).trim();
  if (selected && selected !== "0" && selected !== "new") {
    const { loan, principal, interest } = await loanBalance(database, actor, selected, date, id);
    const principalPaid = positive(fieldValue(fields, "principal_repay", "0"), "Principal paid", true), interestPaid = positive(fieldValue(fields, "interest_repay", "0"), "Interest paid", true);
    if (principalPaid.gt(principal)) throw new Error("Principal paid cannot exceed the loan balance.");
    if (interestPaid.gt(interest)) throw new Error("Interest paid cannot exceed the accrued interest.");
    if (principalPaid.add(interestPaid).isZero()) throw new Error("Enter a principal or interest payment.");
    const f = jsonFields(loan.fields), from = await account(database, actor, fieldValue(f, "partytype")), to = await account(database, actor, fieldValue(f, "Topartytype"));
    const amount = money(principalPaid.add(interestPaid)), posts: LedgerPosting[] = [];
    if (["bank", "cash"].includes(from.type)) {
      posts.push({ entityType: from.type, entityId: from.id, debit: amount }, { entityType: to.type, entityId: to.id, credit: principalPaid }, { entityType: "revenue", entityId: "interest", credit: interestPaid });
    } else {
      posts.push({ entityType: to.type, entityId: to.id, credit: amount }, { entityType: from.type, entityId: from.id, debit: principalPaid }, { entityType: "expense", entityId: "interest", debit: interestPaid });
    }
    const entry = await save("interest", { name: `Loan Repayment — ${from.name}`, date, amount, quantity: quantity(0), rate: quantity(0), status: "active", fields: { ...fields, type: "Repayment", loan_id: loan.id, loan: loan.id, partytype: f.partytype, Topartytype: f.Topartytype, principal_repay: principalPaid.toString(), interest_repay: interestPaid.toString(), loan_balance: principal.toString(), interest_payable: interest.toString(), balance_after_payment: principal.sub(principalPaid).toString() } }, posts, id);
    await refreshLoan(database, loan.id);
    return { message: "Loan repayment saved.", entries: [{ id: entry.id, number: entry.number }] };
  }
  const from = await account(database, actor, fieldValue(fields, "partytype")), to = await account(database, actor, fieldValue(fields, "Topartytype"));
  if (from.id === to.id) throw new Error("Choose two different parties for the loan.");
  const amount = money(positive(fieldValue(fields, "trans_amnt", "0"), "Loan amount")), rate = positive(fieldValue(fields, "interest", "0"), "Yearly interest rate", true);
  if (rate.gt(1000)) throw new Error("Enter a yearly interest rate no greater than 1000 percent.");
  const existing = id ? await database.petrosoftEntry.findFirst({ where: { id, workspaceId: actor.workspaceId, module: "interest" } }) : null;
  if (existing && await database.petrosoftEntry.count({ where: { workspaceId: actor.workspaceId, module: "interest", status: { not: "void" }, fields: { path: ["loan_id"], equals: id } } })) throw new Error("Reverse this loan's repayments before changing its principal or interest rate.");
  const entry = await save("interest", { name: `Loan — ${from.name}`, date, amount, quantity: quantity(0), rate: quantity(rate), status: "active", fields: { ...fields, type: "Loan", partytype: `${from.id}|${from.type}`, Topartytype: `${to.id}|${to.type}`, interest: rate.toString(), loan_amount: amount.toString(), balance_amount: amount.toString(), balance_after_payment: amount.toString(), closed: false } }, [{ entityType: from.type, entityId: from.id, credit: amount }, { entityType: to.type, entityId: to.id, debit: amount }], id);
  return { message: "Loan saved.", entries: [{ id: entry.id, number: entry.number }] };
}
export async function refreshLoan(database: Database, loanId: string) {
  const loan = await database.petrosoftEntry.findUnique({ where: { id: loanId } });
  if (!loan) return;
  const payments = await database.petrosoftEntry.findMany({ where: { workspaceId: loan.workspaceId, module: "interest", status: { not: "void" }, fields: { path: ["loan_id"], equals: loanId } } });
  const balance = money(loan.amount).sub(payments.reduce((sum, entry) => sum.add(fieldValue(jsonFields(entry.fields), "principal_repay", "0")), money(0)));
  await database.petrosoftEntry.update({ where: { id: loanId }, data: { fields: safeFields({ ...jsonFields(loan.fields), balance_amount: balance.toString(), balance_after_payment: balance.toString(), closed: balance.isZero() }) } });
}
