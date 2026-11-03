import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

export const SOURCE_ORIGIN = "https://petrosoft.ymtsindia.in";
export const SOURCE_ARCHIVE_TABLE = "source-archive";
export interface SourceRecord {
  kind: "native-table" | "view" | "report" | "manifest";
  key: string;
  capturedAt: string;
  data: unknown;
}

const secret = /password|passwd|pwd|^pass$|^u_pass$|auth_token|access_token|device_token|api_key|auth_secret|aspid|sender_id|sms_url|sms_username|api_link|^token$/i;
export function scrubSource(value: unknown): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(scrubSource);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !secret.test(key)).map(([key, item]) => [key, scrubSource(item)]));
  }
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error("Unsupported source data value.");
}

export function sourceHash(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item && typeof item === "object" ? Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical((item as Record<string, unknown>)[key])])) : item;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

/** Content-addressed source copies; operational entries, postings, and settings are untouched. */
export async function archiveSourceRecords(database: PrismaClient, workspaceId: string, referenceCode: string,
  records: AsyncIterable<SourceRecord> | Iterable<SourceRecord>) {
  const workspace = await database.petrosoftWorkspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { referenceCode: true } });
  if (workspace.referenceCode !== referenceCode) throw new Error("Source station does not match the destination station.");
  let stored = 0, alreadyStored = 0, sourceRows = 0;
  for await (const record of records) {
    if (!/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(record.key)) throw new Error("Invalid source record key.");
    const data = scrubSource(record.data), contentHash = sourceHash(data);
    const nativeRows = data && !Array.isArray(data) && typeof data === "object" ? (data as Prisma.InputJsonObject).rows : undefined;
    if (record.kind === "native-table" && Array.isArray(nativeRows)) sourceRows += nativeRows.length;
    const result = await database.petrosoftNativeRecord.createMany({ data: [{
      workspaceId, tableName: SOURCE_ARCHIVE_TABLE, nativeId: `${record.kind}/${record.key}/${contentHash}`,
      fields: { origin: SOURCE_ORIGIN, kind: record.kind, key: record.key, capturedAt: record.capturedAt, contentHash, data },
    }], skipDuplicates: true });
    stored += result.count;
    alreadyStored += 1 - result.count;
  }
  return { stored, alreadyStored, sourceRows };
}
