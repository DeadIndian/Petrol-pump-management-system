import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash, randomBytes, scryptSync, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { spawnSync } from "node:child_process";
import { config } from "dotenv";
import { Prisma, PrismaClient } from "@prisma/client";
import { nativeEntries, nativeId, nativeSettings, jsonInput, type NativeBackup } from "../../lib/petrosoft/native";
import { jsonFields, fieldValue } from "../../lib/petrosoft/catalog";
import { money, quantity, safeFields } from "../../lib/petrosoft/rules";
import { permissionsForPages } from "../../lib/petrosoft/permissions";
import { attachNativeLinks } from "../../lib/petrosoft/links";

config({ path: ".env.petrosoft.local", quiet: true });
const databaseUrl = process.env.PETROSOFT_DATABASE_URL || "postgresql://petrosoft:petrosoft-local-development@127.0.0.1:54330/petrosoft";
const argument = (name: string, fallback = "") => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1] || fallback; };
const database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const passwordHash = (password: string) => { const salt = randomBytes(16).toString("hex"); return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`; };

async function chunked<T>(items: T[], save: (items: T[]) => Promise<unknown>, size = 300) {
  for (let offset = 0; offset < items.length; offset += size) await save(items.slice(offset, offset + size));
}

async function synchronizeMetadata(workspaceId: string, settings: Prisma.InputJsonObject, backup: NativeBackup) {
  const settingsEdited = await database.petrosoftAudit.count({ where: { workspaceId, module: { in: ["settings", "organization", "print-templates"] }, action: "SETTINGS_UPDATED" } });
  if (!settingsEdited) {
    const workspace = await database.petrosoftWorkspace.findUniqueOrThrow({ where: { id: workspaceId } });
    await database.petrosoftWorkspace.update({ where: { id: workspaceId }, data: { settings: safeFields({ ...jsonFields(workspace.settings), ...settings }) } });
  }
  for (const role of backup.tables.user_roles || []) {
    const entry = await database.petrosoftEntry.findFirst({ where: { workspaceId, module: "roles", externalId: String(role.role_id), createdBy: "Imported", status: { not: "void" } } });
    if (!entry || await database.petrosoftAudit.count({ where: { workspaceId, entryId: entry.id, action: "UPDATE" } })) continue;
    const pageIds = (backup.tables.user_roles_pages || []).filter(page => page.role_id === role.role_id).map(page => String(page.page_id));
    const permissions = role.module === "Super Admin" ? ["*"] : permissionsForPages(pageIds);
    await database.petrosoftEntry.update({ where: { id: entry.id }, data: { fields: safeFields({ ...jsonFields(entry.fields), permissions, page_ids: pageIds }) } });
    await database.petrosoftUser.updateMany({ where: { workspaceId, role: entry.name }, data: { permissions } });
  }
  return attachNativeLinks(database, workspaceId);
}

async function main() {
  if (!process.argv.includes("--skip-stack")) {
    for (const [command, args] of [
      ["docker", ["compose", "-f", "compose.petrosoft.yaml", "up", "-d", "--wait"]],
      ["node_modules/.bin/prisma", ["migrate", "deploy"]],
      ["node_modules/.bin/prisma", ["generate"]],
    ] as const) {
      const result = spawnSync(command, [...args], { stdio: "inherit", env: { ...process.env, DATABASE_URL: databaseUrl } });
      if (result.status !== 0) throw new Error(`${command} failed.`);
    }
  }
  const referenceCode = argument("--code", "BZ2035764");
  const username = argument("--user", "admin");
  const existing = await database.petrosoftWorkspace.findUnique({ where: { referenceCode } });
  if (existing && !process.argv.includes("--add-data") && !process.argv.includes("--rebook") && !process.argv.includes("--repair-native") && !process.argv.includes("--sync-metadata") && !process.argv.includes("--reset-password")) {
    console.log(`Petrosoft station is already initialized. ${await database.petrosoftEntry.count({ where: { workspaceId: existing.id } })} local entries.`);
    return;
  }
  let password = process.env.PETROSOFT_ADMIN_PASSWORD || "";
  if (!password && (process.argv.includes("--password-stdin") || !existing || process.argv.includes("--reset-password"))) {
    console.log("Enter the local administrator password:");
    if (process.stdin.isTTY) {
      // Disable terminal echo while reading the credential; do not write it to disk.
      spawnSync("stty", ["-echo"], { stdio: "inherit" });
    }
    const reader = createInterface({ input: process.stdin, terminal: false });
    password = await new Promise<string>(resolve => reader.once("line", line => { reader.close(); resolve(line); }));
    if (process.stdin.isTTY) spawnSync("stty", ["echo"], { stdio: "inherit" });
  }
  if ((!existing || process.argv.includes("--reset-password")) && password.length < 4) throw new Error("Use an administrator password with at least four characters.");
  const backupPath = argument("--native", ".petrosoft/native.json");
  const empty = process.argv.includes("--empty");
  let backup: NativeBackup = { format: "petrosoft-native-v1", sourceSha256: "", insertRows: 0, tables: {} };
  if (!empty) try { backup = JSON.parse(await readFile(backupPath, "utf8")) as NativeBackup; } catch { console.log("Starting with an empty station; no private data export was supplied."); }
  let htmlSettings = {};
  if (!empty) try { htmlSettings = jsonFields(JSON.parse(await readFile(".petrosoft/import.json", "utf8")).settings); } catch { /* An empty installation is supported. */ }
  const settings = nativeSettings(backup, htmlSettings);
  const workspace = existing || await database.petrosoftWorkspace.create({ data: { referenceCode, name: argument("--name", fieldValue(settings, "company_name", "SRI KRISHNA FILLING STATION")), settings } });
  const admin = await database.petrosoftUser.upsert({ where: { workspaceId_username: { workspaceId: workspace.id, username } },
    create: { workspaceId: workspace.id, username, fullName: "Admin", passwordHash: passwordHash(password), role: "Super Admin", permissions: ["*"] },
    update: password ? { passwordHash: passwordHash(password) } : {} });
  if (process.argv.includes("--reset-password")) {
    await database.petrosoftSession.deleteMany({ where: { userId: admin.id } });
    console.log("Local administrator password updated.");
    return;
  }
  if (existing && process.argv.includes("--sync-metadata")) {
    const linked = await synchronizeMetadata(workspace.id, settings, backup);
    console.log(`Synchronized original permissions, feature settings, and ${linked} source transaction links. Business entries and ledger postings were retained.`);
    return;
  }
  const imported = nativeEntries(backup);
  const entryData: Prisma.PetrosoftEntryCreateManyInput[] = imported.map(item => ({
    id: randomUUID(), workspaceId: workspace.id, module: item.module, number: item.number, externalId: item.externalId,
    name: item.row.name, date: item.row.date, amount: item.row.amount, quantity: item.row.quantity, rate: item.row.rate,
    status: item.row.status, fields: safeFields(item.row.fields), createdBy: "Imported",
  }));
  await chunked(entryData, data => database.petrosoftEntry.createMany({ data, skipDuplicates: true }));
  const localEntries = await database.petrosoftEntry.findMany({ where: { workspaceId: workspace.id }, select: { id: true, module: true, externalId: true } });
  const localIds = new Map(localEntries.map(item => [`${item.module}:${item.externalId}`, item.id]));
  if (process.argv.includes('--repair-native')) {
    for (const item of imported) {
      const id=localIds.get(`${item.module}:${item.externalId}`);
      if (id) await database.petrosoftEntry.updateMany({ where: { id, createdBy: 'Imported' }, data: { amount: item.row.amount, quantity: item.row.quantity, rate: item.row.rate, status: item.row.status, fields: safeFields(item.row.fields) } });
    }
  }
  const ledgers: Prisma.PetrosoftLedgerCreateManyInput[] = [];
  for (const item of imported) {
    const entryId = localIds.get(`${item.module}:${item.externalId}`);
    if (!entryId || item.row.status === "void") continue;
    for (const post of item.posts) ledgers.push({ id: randomUUID(), entryId, date: item.row.date, entityType: post.entityType,
      entityId: post.entityId === "__SELF__" ? item.externalId : post.entityId, debit: money(post.debit ?? 0), credit: money(post.credit ?? 0), quantity: quantity(post.quantity ?? 0), description: post.description || "" });
  }
  const existingLedgers = await database.petrosoftLedger.count({ where: { entry: { workspaceId: workspace.id } } });
  if (process.argv.includes("--rebook") || process.argv.includes('--repair-native')) await database.petrosoftLedger.deleteMany({ where: { entry: { workspaceId: workspace.id, createdBy: "Imported" } } });
  if (!existingLedgers || process.argv.includes("--rebook") || process.argv.includes('--repair-native')) await chunked(ledgers, data => database.petrosoftLedger.createMany({ data }));
  const sequenceMax = new Map<string, number>();
  for (const entry of imported) sequenceMax.set(entry.module, Math.max(sequenceMax.get(entry.module) || 0, entry.number));
  for (const [module, value] of sequenceMax) {
    const previous=await database.petrosoftSequence.findUnique({ where: { workspaceId_module: { workspaceId: workspace.id, module } } });
    await database.petrosoftSequence.upsert({ where: { workspaceId_module: { workspaceId: workspace.id, module } }, create: { workspaceId: workspace.id, module, value }, update: { value: Math.max(value, previous?.value || 0) } });
  }
  const nativeRecords: Prisma.PetrosoftNativeRecordCreateManyInput[] = [];
  for (const [tableName, rows] of Object.entries(backup.tables)) {
    if (["logfile", "users", "company_info", "options"].includes(tableName)) continue;
    rows.forEach((fields, index) => nativeRecords.push({ id: randomUUID(), workspaceId: workspace.id, tableName, nativeId: nativeId(fields, index), fields: safeFields(fields) }));
  }
  await chunked(nativeRecords, data => database.petrosoftNativeRecord.createMany({ data, skipDuplicates: true }));
  const sourceUsers = new Map((backup.tables.users || []).map(user => [String(user.user_id), String(user.username || "Imported")]));
  const audits = (backup.tables.logfile || []).map(log => ({ id: randomUUID(), workspaceId: workspace.id, userId: admin.id,
    username: sourceUsers.get(String(log.user_id)) || "Imported", module: String(log.module || "audit"), action: String(log.event || "IMPORTED"),
    createdAt: new Date(String(log.date_time || log.created_date).replace(" ", "T") + "Z") }));
  if (!await database.petrosoftAudit.count({ where: { workspaceId: workspace.id } })) {
    await chunked(audits.filter(log => Number.isFinite(log.createdAt.getTime())), data => database.petrosoftAudit.createMany({ data }));
    await database.petrosoftAudit.create({ data: { workspaceId: workspace.id, userId: admin.id, username, module: "backup", action: "NATIVE_IMPORT", after: jsonInput({ sha256: backup.sourceSha256, entries: imported.length, nativeRecords: nativeRecords.length }) } });
  }
  await synchronizeMetadata(workspace.id, settings, backup);
  await mkdir(".petrosoft", { recursive: true, mode: 0o700 });
  let environment = "";
  try { environment = await readFile(".env.petrosoft.local", "utf8"); } catch { /* Create the local environment on first setup. */ }
  environment = /^PETROSOFT_DATABASE_URL=.*$/m.test(environment) ? environment.replace(/^PETROSOFT_DATABASE_URL=.*$/m, `PETROSOFT_DATABASE_URL=${databaseUrl}`) : `${environment}${environment && !environment.endsWith("\n") ? "\n" : ""}PETROSOFT_DATABASE_URL=${databaseUrl}\n`;
  await writeFile(".env.petrosoft.local", environment, { mode: 0o600 });
  await writeFile(".petrosoft/setup.json", JSON.stringify({ referenceCode, username, entries: imported.length, sha256: backup.sourceSha256, initializedAt: new Date().toISOString(), sourceDigest: createHash("sha256").update(backup.sourceSha256).digest("hex") }), { mode: 0o600 });
  console.log(`Initialized ${workspace.name}: ${imported.length} entries, ${nativeRecords.length} supplementary records and ${audits.length} audit events. Start with npm run dev:petrosoft.`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Petrosoft setup failed."); process.exitCode = 1; }).finally(() => database.$disconnect());
