import { Prisma } from "@prisma/client";
import { fieldValue, type ModuleSchema } from "./catalog";
import type { NormalizedRow } from "./rules";

export async function validateEntryUniqueness(database: Prisma.TransactionClient, workspaceId: string, module: ModuleSchema, row: NormalizedRow, seen: Set<string>, id?: string) {
  let key = "", clauses: Prisma.PetrosoftEntryWhereInput[] = [], dated = false;
  const f = row.fields;
  if (module.id === "meter-sales") {
    const nozzle = fieldValue(f, "nozzle_id"), shift = fieldValue(f, ["shift", "shift_input"], "S-1");
    f.shift = shift;
    key = `${row.date.toISOString()}:${nozzle}:${shift}`; dated = true;
    clauses = [{ fields: { path: ["nozzle_id"], equals: nozzle } }, { OR: [{ fields: { path: ["shift"], equals: shift } }, ...(shift === "S-1" ? [{ fields: { path: ["shift"], equals: "" } }, { fields: { path: ["shift"], equals: Prisma.AnyNull } }] : [])] }];
  } else if (module.id === "nozzles") {
    const tank = fieldValue(f, "tank_no"); key = `${tank}:${row.name.toLowerCase()}`;
    clauses = [{ name: { equals: row.name, mode: "insensitive" } }, { fields: { path: ["tank_no"], equals: tank } }];
  } else if (module.id === "pump-settings") {
    const nozzle = fieldValue(f, "noz"); key = nozzle; clauses = [{ OR: [{ fields: { path: ["noz"], equals: nozzle } }, { fields: { path: ["nozzel_id"], equals: nozzle } }] }];
  } else if (module.kind === "master" && !["loyalty-points", "pump-incentives", "customer-discounts", "employee-benefits"].includes(module.id)) {
    key = row.name.toLowerCase(); clauses = [{ name: { equals: row.name, mode: "insensitive" } }];
  }
  if (!key) return;
  const batchKey = `${module.id}:${key}`;
  if (seen.has(batchKey)) throw new Error(module.id === "meter-sales" ? "A nozzle can appear only once for each date and shift." : "The same master appears more than once in this batch.");
  seen.add(batchKey);
  const duplicate = await database.petrosoftEntry.findFirst({ where: { workspaceId, module: module.id, status: { not: "void" }, ...(dated ? { date: row.date } : {}), ...(id ? { id: { not: id } } : {}), AND: clauses } });
  if (duplicate) throw new Error(module.id === "meter-sales" ? "This nozzle already has a meter entry for this date and shift. Edit the existing entry." : module.id === "pump-settings" ? "This nozzle is already assigned to a pump. Edit its existing pump setting." : `An entry named ${row.name} already exists${module.id === "nozzles" ? " in this tank" : ""}.`);
  if (module.id === "tanks") {
    const tank = fieldValue(f, "tank_no");
    if (tank && await database.petrosoftEntry.count({ where: { workspaceId, module: "tanks", status: { not: "void" }, fields: { path: ["tank_no"], equals: tank }, ...(id ? { id: { not: id } } : {}) } })) throw new Error("This tank number is already registered.");
  }
}
