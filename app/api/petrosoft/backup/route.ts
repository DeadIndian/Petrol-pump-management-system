import { NextRequest } from "next/server";
import { authenticated, apiError, attachmentHeaders } from "@/lib/petrosoft/http";
import { hasPermission } from "@/lib/petrosoft/auth";
import { PetrosoftError } from "@/lib/petrosoft/actions";
import { petrosoftDb } from "@/lib/petrosoft/db";
import { safeFields } from "@/lib/petrosoft/rules";
import { jsonFields } from "@/lib/petrosoft/catalog";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { uploadDirectory } from "@/lib/petrosoft/attachments";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const actor = await authenticated(request, true);
    if (!hasPermission(actor, "backup", "edit")) throw new PetrosoftError("Your role cannot back up this installation.", 403);
    const workspaceId = actor.workspaceId;
    const [entries, ledger, users, sequences, attachments, nativeRecords, audits] = await Promise.all([
      petrosoftDb.petrosoftEntry.findMany({ where: { workspaceId } }), petrosoftDb.petrosoftLedger.findMany({ where: { entry: { workspaceId } } }),
      petrosoftDb.petrosoftUser.findMany({ where: { workspaceId }, select: { id: true, username: true, fullName: true, role: true, active: true, permissions: true } }),
      petrosoftDb.petrosoftSequence.findMany({ where: { workspaceId } }), petrosoftDb.petrosoftAttachment.findMany({ where: { workspaceId } }),
      petrosoftDb.petrosoftNativeRecord.findMany({ where: { workspaceId } }), petrosoftDb.petrosoftAudit.findMany({ where: { workspaceId } }),
    ]);
    const files = await Promise.all(attachments.map(async item => ({ ...item, data: (await readFile(join(uploadDirectory(), item.storageName)).catch(() => Buffer.alloc(0))).toString("base64") })));
    const backup = { format: "petrosoft-local-v1", generatedAt: new Date().toISOString(), workspace: { ...actor.workspace, settings: safeFields(jsonFields(actor.workspace.settings)) }, users,
      entries: entries.map(entry => ({ ...entry, fields: safeFields(jsonFields(entry.fields)) })), ledger, sequences, attachments: files, nativeRecords, audits };
    await petrosoftDb.petrosoftAudit.create({ data: { workspaceId, userId: actor.id, username: actor.username, module: "backup", action: "BACKUP_EXPORTED" } });
    return new Response(JSON.stringify(backup), { headers: attachmentHeaders(`Petrosoft-backup-${new Date().toISOString().slice(0, 10)}.json`, "application/json") });
  } catch (error) { return apiError(error); }
}
