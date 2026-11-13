import { spawnSync } from "node:child_process";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { moduleById, primaryForm, type BunkBookFields } from "../../lib/bunkbook/catalog";
import type { BunkBookActor } from "../../lib/bunkbook/auth";
import type { ActionInput } from "../../lib/bunkbook/actions";

config({ path: ".env.bunkbook.local", quiet: true });

// Tests never touch the real station. They run against a dedicated `*_test` database that is
// created and migrated on demand and wiped between tests.
const realUrl = process.env.BUNKBOOK_DATABASE_URL || "postgresql://bunkbook:bunkbook-local-development@127.0.0.1:54330/bunkbook";
export const testDatabaseUrl = process.env.BUNKBOOK_TEST_DATABASE_URL || realUrl.replace(/\/[^/?]+(\?|$)/, "/bunkbook_test$1");
const testDatabaseName = new URL(testDatabaseUrl).pathname.slice(1);
if (!testDatabaseName.endsWith("_test")) throw new Error(`Refusing to run tests against "${testDatabaseName}": the test database name must end in _test.`);
process.env.BUNKBOOK_DATABASE_URL = testDatabaseUrl;

let prepared: Promise<void> | undefined;
export function prepareTestDatabase() {
  return prepared ||= (async () => {
    const admin = new PrismaClient({ log: [], datasources: { db: { url: testDatabaseUrl.replace(/\/[^/?]+(\?|$)/, "/postgres$1") } } });
    try { await admin.$executeRawUnsafe(`CREATE DATABASE "${testDatabaseName}"`); } catch { /* already exists */ } finally { await admin.$disconnect(); }
    const result = spawnSync("node_modules/.bin/prisma", ["migrate", "deploy"], { env: { ...process.env, DATABASE_URL: testDatabaseUrl }, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`Could not migrate the test database: ${result.stderr || result.stdout}`);
  })();
}

async function resetTestDatabase(db: PrismaClient) {
  const current = (await db.$queryRawUnsafe<{ current_database: string }[]>("SELECT current_database()"))[0].current_database;
  if (!current.endsWith("_test")) throw new Error("Refusing to reset a non-test database.");
  await db.$executeRawUnsafe('TRUNCATE "bunkbook_ledger", "bunkbook_entries", "bunkbook_audits", "bunkbook_attachments", "bunkbook_native_records", "bunkbook_sequences", "bunkbook_sessions", "bunkbook_users", "bunkbook_station" RESTART IDENTITY CASCADE');
}

export async function runtime() {
  await prepareTestDatabase();
  const [{ bunkbookDb }, actions, queries, auth] = await Promise.all([import("../../lib/bunkbook/db"), import("../../lib/bunkbook/actions"), import("../../lib/bunkbook/queries"), import("../../lib/bunkbook/auth")]);
  return { db: bunkbookDb, ...actions, ...queries, ...auth };
}

export async function station() {
  const api = await runtime();
  await resetTestDatabase(api.db);
  const station = await api.db.bunkBookStation.create({ data: { id: "station", name: "BunkBook isolated verification", settings: { currency: "₹", num_fmt: "en-IN", date_ctl: "no", credit_limit: "yes", purchase_policy: { lfr_tot: "yes", delar_comm: "yes" } } } });
  const user = await api.db.bunkBookUser.create({ data: { username: "admin", fullName: "Verification Admin", passwordHash: api.hashPassword("test-local-password"), role: "Super Admin", permissions: ["*"] } });
  const actor: BunkBookActor = { ...user, station };
  const seed = async (module: string, number: number, name: string, fields: BunkBookFields = {}, date = "2020-01-01") => {
    const entry = await api.db.bunkBookEntry.create({ data: { module, number, externalId: String(number), name, date: new Date(date + "T00:00:00Z"), fields: JSON.parse(JSON.stringify(fields)), createdBy: "Verification" } });
    await api.db.bunkBookSequence.upsert({ where: { module }, create: { module, value: number }, update: { value: number } });
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
  const submit = (module: string, fields: BunkBookFields, id?: string, operation = "save") => {
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
  const entry = (id: string) => api.db.bunkBookEntry.findUniqueOrThrow({ where: { id } });
  const cleanup = async () => { await resetTestDatabase(api.db); };
  return { ...api, actor, station, submit, action, entry, seed, cleanup };
}

export type Station = Awaited<ReturnType<typeof station>>;
export const ids = (result: unknown): string[] => {
  const value = result as { entries?: ({ id: string } | string)[]; id?: string };
  return value.entries ? value.entries.map(entry => typeof entry === "string" ? entry : entry.id) : value.id ? [value.id] : [];
};
