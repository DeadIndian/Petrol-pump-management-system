import { NextRequest } from "next/server";
import { authenticated, apiError, attachmentHeaders } from "@/lib/bunkbook/http";
import { hasPermission } from "@/lib/bunkbook/auth";
import { BunkBookError } from "@/lib/bunkbook/actions";
import { bunkbookDb } from "@/lib/bunkbook/db";
import { safeFields } from "@/lib/bunkbook/rules";
import { jsonFields } from "@/lib/bunkbook/catalog";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { uploadDirectory } from "@/lib/bunkbook/attachments";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const actor = await authenticated(request, true);
    if (!hasPermission(actor, "backup", "edit")) throw new BunkBookError("Your role cannot back up this installation.", 403);
    const [entries, ledger, users, sequences, attachments, nativeRecords, audits] = await Promise.all([
      bunkbookDb.bunkBookEntry.findMany({ where: {} }), bunkbookDb.bunkBookLedger.findMany({ where: { entry: {} } }),
      bunkbookDb.bunkBookUser.findMany({ where: {}, select: { id: true, username: true, fullName: true, role: true, active: true, permissions: true } }),
      bunkbookDb.bunkBookSequence.findMany({ where: {} }), bunkbookDb.bunkBookAttachment.findMany({ where: {} }),
      bunkbookDb.bunkBookNativeRecord.findMany({ where: {} }), bunkbookDb.bunkBookAudit.findMany({ where: {} }),
    ]);
    const files = await Promise.all(attachments.map(async item => ({ ...item, data: (await readFile(join(uploadDirectory(), item.storageName)).catch(() => Buffer.alloc(0))).toString("base64") })));
    const backup = { format: "bunkbook-local-v1", generatedAt: new Date().toISOString(), station: { ...actor.station, settings: safeFields(jsonFields(actor.station.settings)) }, users,
      entries: entries.map(entry => ({ ...entry, fields: safeFields(jsonFields(entry.fields)) })), ledger, sequences, attachments: files, nativeRecords, audits };
    await bunkbookDb.bunkBookAudit.create({ data: { userId: actor.id, username: actor.username, module: "backup", action: "BACKUP_EXPORTED" } });
    return new Response(JSON.stringify(backup), { headers: attachmentHeaders(`BunkBook-backup-${new Date().toISOString().slice(0, 10)}.json`, "application/json") });
  } catch (error) { return apiError(error); }
}
