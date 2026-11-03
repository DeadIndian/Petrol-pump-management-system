import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { moduleById, primaryForm, type PetrosoftFields } from "../../lib/petrosoft/catalog";
import type { PetrosoftActor } from "../../lib/petrosoft/auth";
import type { ActionInput } from "../../lib/petrosoft/actions";

config({ path: ".env.petrosoft.local", quiet: true });
process.env.PETROSOFT_DATABASE_URL ||= "postgresql://petrosoft:petrosoft-local-development@127.0.0.1:54330/petrosoft";

export async function runtime() {
  const [{ petrosoftDb }, actions, queries, auth] = await Promise.all([import("../../lib/petrosoft/db"), import("../../lib/petrosoft/actions"), import("../../lib/petrosoft/queries"), import("../../lib/petrosoft/auth")]);
  return { db: petrosoftDb, ...actions, ...queries, ...auth };
}

export async function station() {
  const api = await runtime(), referenceCode = `TEST-PETROSOFT-${randomUUID().toUpperCase()}`;
  const workspace = await api.db.petrosoftWorkspace.create({ data: { referenceCode, name: "Petrosoft isolated verification", settings: { currency: "₹", num_fmt: "en-IN", date_ctl: "no", credit_limit: "yes", purchase_policy: { lfr_tot: "yes", delar_comm: "yes" } } } });
  const actor: PetrosoftActor = await api.db.petrosoftUser.create({ data: { workspaceId: workspace.id, username: "admin", fullName: "Verification Admin", passwordHash: api.hashPassword("test-local-password"), role: "Super Admin", permissions: ["*"] }, include: { workspace: true } });
  const seed = async (module: string, number: number, name: string, fields: PetrosoftFields = {}, date = "2020-01-01") => {
    const entry = await api.db.petrosoftEntry.create({ data: { workspaceId: workspace.id, module, number, externalId: String(number), name, date: new Date(date + "T00:00:00Z"), fields: JSON.parse(JSON.stringify(fields)), createdBy: "Verification" } });
    await api.db.petrosoftSequence.upsert({ where: { workspaceId_module: { workspaceId: workspace.id, module } }, create: { workspaceId: workspace.id, module, value: number }, update: { value: number } });
    return entry;
  };
  await seed("fuel-products", 1, "MS", { liqpro_name: "MS", short_name: "MS", sale_rate: "100", vat: "20", tcs: "1", lfr: "10" });
  await seed("fuel-products", 2, "HSD", { liqpro_name: "HSD", sale_rate: "90", vat: "20" });
  await seed("lubricants", 1, "Engine Oil", { pro_name: "Engine Oil", sale_rate: "200", gst: "18" });
  await seed("customers", 1, "Customer A", { org_name: "Customer A", cust_name: "Contact", credit_limit: "0", open_bal: "0" });
  await seed("vendors", 1, "Supplier", { ven_comp: "Supplier", gst_no: "29TEST0000000" });
  await seed("business-parties", 1, "Bank", { crd_name: "Bank", p_type: "Bank" });
  await seed("business-parties", 2, "Owner", { crd_name: "Owner", p_type: "Owner" });
  await seed("employees", 1, "DSM", { emp_name: "DSM", salary: "500", salary_type: "per duty", pf: "0", esi: "0" });
  await seed("tanks", 1, "MS Tank", { tank_no: "T1", tank_name: "MS Tank", tank_cap: "20000", product: "1", pro_name: "1" });
  await seed("nozzles", 1, "N1", { nozzle_name: "N1", noz_name: "N1", tank_no: "T1", product: "1" });
  await seed("pump-settings", 1, "P1", { pump_name: "P1", tank_no: "T1", noz: "1", product: "1" });
  await seed("swipe-machines", 1, "POS", { swipe_name: "POS", attach_bank: "1", attach_type: "Bank", attach_id: "1" });
  await seed("expense-types", 1, "Maintenance", { exp_name: "Maintenance", effect_income: "Outflow" });
  await seed("roles", 1, "Super Admin", { role_name: "Super Admin", permissions: ["*"] });
  await seed("users", 1, "admin", { user_name: "admin", username: "admin", role: "1" });
  await seed("duty-shifts", 1, "General", { shift_type: "General", duties: "2" });
  const submit = (module: string, fields: PetrosoftFields, id?: string, operation = "save") => {
    const form = primaryForm(moduleById.get(module)!);
    const input = { ...fields };
    for (const field of id ? [] : form?.fields || []) {
      if (!field.required || ["hidden", "file", "checkbox", "radio"].includes(field.type) || input[field.name] !== undefined || input[field.name.replace(/\[\]$/, "")] !== undefined) continue;
      if (["daily-rates", "shift-sheet"].includes(module) && /^(new_rate|cls_rate|var_amt)\[/.test(field.name)) continue;
      if (field.relation) continue;
      input[field.name.replace(/\[\]$/, "")] = /date|_dt$/.test(field.name) ? fields.insert_date || fields.pur_date || "2026-01-01" : /vehicle|vehi/.test(field.name) ? "KA01TEST1" : /bill|indent/.test(field.name) ? "TEST-1" : "0";
    }
    return api.executeAction(actor, { module, operation, id, fields: input });
  };
  const action = (input: ActionInput) => api.executeAction(actor, input);
  const entry = (id: string) => api.db.petrosoftEntry.findUniqueOrThrow({ where: { id } });
  const cleanup = async () => {
    const current = await api.db.petrosoftWorkspace.findUnique({ where: { id: workspace.id } });
    if (current?.referenceCode !== referenceCode || !referenceCode.startsWith("TEST-PETROSOFT-")) throw new Error("Refusing to remove a non-test workspace.");
    await api.db.petrosoftWorkspace.delete({ where: { id: workspace.id } });
  };
  return { ...api, actor, workspace, submit, action, entry, seed, cleanup };
}

export type Station = Awaited<ReturnType<typeof station>>;
export const ids = (result: unknown): string[] => {
  const value = result as { entries?: ({ id: string } | string)[]; id?: string };
  return value.entries ? value.entries.map(entry => typeof entry === "string" ? entry : entry.id) : value.id ? [value.id] : [];
};
