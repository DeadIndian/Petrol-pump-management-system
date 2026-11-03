import { Prisma, type PetrosoftEntry } from "@prisma/client";
import type { PetrosoftActor } from "./auth";
import { dateValue, fieldValue, jsonFields, today, type PetrosoftFields } from "./catalog";
import { money, positive, quantity, safeFields, type LedgerPosting, type NormalizedRow } from "./rules";

type Database = Prisma.TransactionClient;
type Save = (module: string, row: NormalizedRow, posts?: LedgerPosting[], id?: string) => Promise<PetrosoftEntry>;
const identity = (entry: PetrosoftEntry) => entry.externalId || String(entry.number);
const enabled = (value: unknown) => ["1", "yes", "true", "on"].includes(String(value).toLowerCase());
const employeeId = (fields: PetrosoftFields) => fieldValue(fields, ["employee", "emp_id", "attend_empid"]);
function payrollMonth(fields: PetrosoftFields) {
  const selected = fieldValue(fields, ["month", "salary_month", "frm_dt"], today().toISOString().slice(0, 7));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(selected)) throw new Error("Choose a valid payroll month.");
  return selected;
}

export async function payrollPreview(database: Database, actor: PetrosoftActor, fields: PetrosoftFields) {
  const selected = payrollMonth(fields), from = dateValue(selected + "-01"), to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0)), days = to.getUTCDate();
  const [employees, records, loansLedger] = await Promise.all([
    database.petrosoftEntry.findMany({ where: { workspaceId: actor.workspaceId, module: "employees", status: "active", date: { lte: to } }, orderBy: { name: "asc" } }),
    database.petrosoftEntry.findMany({ where: { workspaceId: actor.workspaceId, module: { in: ["attendance-details", "duty-shifts", "overtime", "employee-benefits", "employee-loans", "employee-payments", "employee-recoveries", "meter-sales"] }, date: { lte: to }, status: { not: "void" } } }),
    database.petrosoftLedger.groupBy({ by: ["entityType", "entityId"], where: { entityType: { in: ["employee-advance", "employee-loan"] }, date: { lte: to }, entry: { workspaceId: actor.workspaceId, status: { not: "void" } } }, _sum: { debit: true, credit: true } }),
  ]);
  const shifts = records.filter(entry => entry.module === "duty-shifts");
  const standardDuties = quantity(fieldValue(jsonFields(shifts[0]?.fields), "duties", "1"));
  const rows = employees.map(employee => {
    const e = jsonFields(employee.fields), id = identity(employee);
    const attendance = records.filter(record => record.module === "attendance-details" && record.date >= from && employeeId(jsonFields(record.fields)) === id);
    let present = 0, paidAbsence = 0, half = 0, unpaid = 0, hours = quantity(0), duties = quantity(0);
    for (const day of attendance) {
      const f = jsonFields(day.fields), type = fieldValue(f, "attend_type", "P"), paid = fieldValue(f, "attend_remark", "Unpaid") === "Paid";
      const shift = shifts.find(entry => entry.name === fieldValue(f, "shift") || identity(entry) === fieldValue(f, "shift"));
      const multiplier = quantity(fieldValue(jsonFields(shift?.fields), "duties", standardDuties.toString()));
      let fraction = 0;
      if (type === "P") { present++; fraction = 1; }
      else if (["P:A", "H"].includes(type)) { half += 0.5; fraction = paid ? 1 : 0.5; }
      else if (paid) { paidAbsence++; fraction = 1; }
      else unpaid++;
      duties = duties.add(multiplier.mul(fraction));
      hours = hours.add(quantity(fieldValue(f, "hours", "0")));
    }
    const benefits = records.filter(record => record.module === "employee-benefits" && employeeId(jsonFields(record.fields)) === id && record.status === "active");
    const basicBenefit = benefits.find(record => /^basic$/i.test(fieldValue(jsonFields(record.fields), ["earn_type", "name"], record.name)));
    const salary = money(fieldValue(e, "salary", "0")), basic = basicBenefit?.amount.gt(0) ? basicBenefit.amount : salary;
    const rate = /month/i.test(fieldValue(e, "salary_type")) ? salary.div(Math.max(1, days)).div(standardDuties.gt(0) ? standardDuties : 1) : salary;
    const earned = money(duties.mul(rate));
    const overtime = records.filter(record => record.module === "overtime" && record.date >= from && employeeId(jsonFields(record.fields)) === id).reduce((sum, record) => sum.add(record.amount), money(0));
    const other = benefits.filter(record => record !== basicBenefit && record.name.trim()).reduce((sum, benefit) => sum.add(benefit.amount), money(0));
    const pf = enabled(e.pf) ? money(basic.mul("0.12")) : money(0), esi = enabled(e.esi) ? money(earned.mul("0.0075")) : money(0);
    const loans = records.filter(record => record.module === "employee-loans" && employeeId(jsonFields(record.fields)) === id && fieldValue(jsonFields(record.fields), "is_closed", "no") !== "yes");
    const loan = loans.reduce((sum, record) => sum.add(fieldValue(jsonFields(record.fields), ["installment", "loan_installment"], "0")), money(0));
    const advanceAccount = loansLedger.find(post => post.entityType === "employee-advance" && post.entityId === id);
    const advance = advanceAccount ? money(advanceAccount._sum.debit || 0).sub(advanceAccount._sum.credit || 0) : money(0);
    const shortage = records.filter(record => record.module === "employee-recoveries" && record.date >= from && employeeId(jsonFields(record.fields)) === id).reduce((sum, record) => sum.add(fieldValue(jsonFields(record.fields), "shortage", "0")), money(0));
    const incentive = records.filter(record => record.module === "meter-sales" && record.date >= from && employeeId(jsonFields(record.fields)) === id).reduce((sum, record) => sum.add(fieldValue(jsonFields(record.fields), ["incentive", "incentives"], "0")), money(0));
    const gross = money(earned.add(other).add(overtime).add(incentive));
    const net = money(gross.sub(pf).sub(esi).sub(loan).sub(advance.gt(0) ? advance : 0).sub(shortage));
    return { employee: id, employee_name: employee.name, month: selected, salary_type: fieldValue(e, "salary_type"), salary: salary.toString(), basic_salary: basic.toString(),
      present_days: present, paid_absents: paidAbsence, half_days: half, absent_days: unpaid, working_days: days, hours: hours.toString(), total_duties: duties.toString(), duty_rate: rate.toDecimalPlaces(4).toString(), duty_salary: rate.toDecimalPlaces(4).toString(),
      total_salary: earned.toString(), benefits: money(other.add(overtime)).toString(), overtime: overtime.toString(), gross_salary: gross.toString(), pf: pf.toString(), esi: esi.toString(), pf_enabled: enabled(e.pf), esi_enabled: enabled(e.esi), it: "0", loan: loan.toString(),
      advance: advance.gt(0) ? advance.toString() : "0", shortage: shortage.toString(), penalty: "0", incentive: incentive.toString(), net_salary: net.lt(0) ? "0" : net.toString(), pay_mode: "Cash", pay_bank: "" };
  });
  return { month: selected, rows, total: rows.reduce((sum, row) => sum.add(row.net_salary), money(0)).toString() };
}

export async function savePayroll(database: Database, actor: PetrosoftActor, operation: string, fields: PetrosoftFields, id: string | undefined, save: Save) {
  const existing = id ? await database.petrosoftEntry.findFirst({ where: { id, workspaceId: actor.workspaceId, module: "payroll", status: { not: "void" } } }) : null;
  if (id && !existing) throw new Error("Choose a payroll from this station.");
  if (existing && jsonFields(existing.fields).paid) throw new Error("This payroll has already been paid. Reverse its payment before changing it.");
  if (operation === "pay" && !existing) throw new Error("Generate the payroll before paying it.");
  const frozen = jsonFields(existing?.fields);
  const selected = payrollMonth(operation === "pay" ? frozen : fields);
  const duplicate = await database.petrosoftEntry.findFirst({ where: { workspaceId: actor.workspaceId, module: "payroll", status: { not: "void" }, fields: { path: ["month"], equals: selected }, ...(id ? { id: { not: id } } : {}) } });
  if (duplicate) throw new Error("Payroll is already generated for this month. Open the existing payroll.");
  const preview = operation === "pay" ? null : await payrollPreview(database, actor, { ...fields, month: selected });
  const offered = operation === "pay" ? frozen.rows : Array.isArray(fields.rows) ? fields.rows : preview?.rows;
  if (!Array.isArray(offered) || !offered.length) throw new Error("Choose employees and preview salaries before generating payroll.");
  const rows: PetrosoftFields[] = [], seen = new Set<string>();
  for (const value of offered) {
    const input = jsonFields(value), employee = employeeId(input);
    if (seen.has(employee)) throw new Error("Each employee can appear only once in a payroll.");
    seen.add(employee);
    const expected = preview?.rows.find(row => row.employee === employee);
    if (preview && !expected) throw new Error("The payroll contains an employee from another station.");
    const row: PetrosoftFields = { ...expected, ...input };
    const gross = positive(fieldValue(row, "total_salary", "0"), "Total salary", true).add(positive(fieldValue(row, "benefits", "0"), "Benefits", true)).add(positive(fieldValue(row, "incentive", "0"), "Incentive", true));
    const deductions = ["pf", "esi", "it", "loan", "advance", "penalty", "shortage"].reduce((sum, key) => sum.add(positive(fieldValue(row, key, "0"), key, true)), money(0));
    const net = money(gross.sub(deductions));
    if (net.lt(0)) throw new Error("Payroll deductions cannot exceed gross salary.");
    row.gross_salary = money(gross).toString(); row.net_salary = net.toString(); rows.push(row);
  }
  const total = rows.reduce((sum, row) => sum.add(fieldValue(row, "net_salary", "0")), money(0));
  const paid = operation === "pay" || fieldValue(fields, "pay_now") === "yes";
  const date = dateValue(fieldValue(fields, ["payment_date", "date"], selected + "-01"));
  const posts: LedgerPosting[] = [];
  if (paid) for (const row of rows) {
    const bank = fieldValue(row, "pay_bank").split("|")[0], isBank = fieldValue(row, "pay_mode", "Cash") === "Bank", employee = employeeId(row);
    if (isBank) {
      const account = await database.petrosoftEntry.findFirst({ where: { workspaceId: actor.workspaceId, module: "business-parties", status: "active", externalId: bank } });
      if (!account || !/bank/i.test(fieldValue(jsonFields(account.fields), "p_type"))) throw new Error("Choose an active bank account for the salary payment.");
    }
    posts.push({ entityType: "expense", entityId: "salary", debit: fieldValue(row, "gross_salary") }, { entityType: isBank ? "bank" : "cash", entityId: isBank ? bank : "cash", credit: fieldValue(row, "net_salary") });
    for (const key of ["pf", "esi", "it", "penalty", "advance", "loan", "shortage"]) {
      const amount = money(fieldValue(row, key, "0"));
      if (!amount.gt(0)) continue;
      const type = key === "advance" ? "employee-advance" : key === "loan" ? "employee-loan" : key === "shortage" ? "employee" : "liability";
      posts.push({ entityType: type, entityId: ["employee-advance", "employee-loan", "employee"].includes(type) ? employee : `payroll-${key}`, credit: amount });
    }
  }
  const parent = await save("payroll", { name: "Pay Roll", date, amount: total, quantity: quantity(0), rate: quantity(0), status: "active", fields: { month: selected, year: selected.slice(0, 4), total_salary: total.toString(), total_employees: rows.length, paid, rows } }, posts, id);
  const children = await database.petrosoftEntry.findMany({ where: { workspaceId: actor.workspaceId, module: "payroll-details", fields: { path: ["payroll_id"], equals: parent.id }, status: { not: "void" } } });
  for (const row of rows) {
    const child = children.find(entry => employeeId(jsonFields(entry.fields)) === employeeId(row));
    await save("payroll-details", { name: fieldValue(row, "employee_name"), date, amount: money(fieldValue(row, "net_salary")), quantity: quantity(0), rate: quantity(0), status: "active", fields: safeFields({ ...row, payroll_id: parent.id, parent_id: parent.id, paid }) }, [], child?.id);
  }
  const removed = children.filter(child => !rows.some(row => employeeId(row) === employeeId(jsonFields(child.fields))));
  if (removed.length) await database.petrosoftEntry.updateMany({ where: { id: { in: removed.map(entry => entry.id) } }, data: { status: "void" } });
  return { message: paid ? "Payroll saved and salary payments posted." : "Payroll generated.", id: parent.id, total: total.toString() };
}
