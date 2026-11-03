import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { petrosoftDb } from "./db";
import { hasPermission, type PetrosoftActor } from "./auth";
import { PetrosoftError } from "./actions";

export const uploadDirectory = () => join(process.env.PETROSOFT_STORAGE || join(process.cwd(), ".petrosoft"), "uploads");
const types: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", pdf: "application/pdf", csv: "text/csv", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", txt: "text/plain", json: "application/json" };
export async function uploadAttachment(actor: PetrosoftActor, file: File, module: string) {
  if (!hasPermission(actor, module, "edit")) throw new PetrosoftError("Your role cannot upload files to this module.", 403);
  if (!file.size || file.size > 20 * 1024 * 1024) throw new PetrosoftError("Choose a file between 1 byte and 20 MB.", 413);
  const filename = file.name.replace(/[\x00-\x1f/\\]/g, "_").slice(0, 150), extension = filename.split(".").pop()?.toLowerCase() || "";
  const contentType = types[extension];
  if (!contentType) throw new PetrosoftError("Choose an image, PDF, spreadsheet, CSV, text, or JSON file.");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (extension === "png" && bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || /jpe?g/.test(extension) && bytes.subarray(0, 2).toString("hex") !== "ffd8" || extension === "pdf" && bytes.subarray(0, 4).toString() !== "%PDF") throw new PetrosoftError("This file does not match its extension.");
  const storageName = `${randomUUID()}.${extension}`;
  await mkdir(uploadDirectory(), { recursive: true, mode: 0o700 });
  const path = join(uploadDirectory(), storageName);
  await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
  try {
    const attachment = await petrosoftDb.petrosoftAttachment.create({ data: { workspaceId: actor.workspaceId, module, filename, storageName, size: file.size, contentType } });
    return { id: attachment.id, filename, contentType, size: file.size };
  } catch (error) { await unlink(path).catch(() => {}); throw error; }
}
export async function readAttachment(actor: PetrosoftActor, id: string) {
  const attachment = await petrosoftDb.petrosoftAttachment.findFirst({ where: { id, workspaceId: actor.workspaceId } });
  if (!attachment) throw new PetrosoftError("File not found.", 404);
  if (!hasPermission(actor, attachment.module)) throw new PetrosoftError("Your role cannot open this file.", 403);
  return { attachment, bytes: new Uint8Array(await readFile(join(uploadDirectory(), attachment.storageName))) };
}
