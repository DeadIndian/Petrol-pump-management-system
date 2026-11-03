import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { archiveSourceRecords, sourceHash, SOURCE_ORIGIN, type SourceRecord } from "../../lib/petrosoft/source-archive";
import type { NativeBackup } from "../../lib/petrosoft/native";

config({ path: ".env.petrosoft.local", quiet: true });
const database = new PrismaClient({ datasources: { db: { url: process.env.PETROSOFT_DATABASE_URL || "postgresql://petrosoft:petrosoft-local-development@127.0.0.1:54330/petrosoft" } } });
interface Capture {
  key: string; path: string; status: string; dataFile?: string; dataSha256?: string; capturedAt?: string; type?: string; sourceError?: boolean;
  recoveredBy?: string[];
}
interface Manifest {
  format: string; origin: string; referenceCode: string; capturedAt: string; completedAt?: string;
  backup: { sourceSha256: string; tablesHash: string }; captures: Capture[];
}

async function main() {
  const index = process.argv.indexOf("--snapshot");
  const directory = await realpath(resolve(index < 0 ? ".petrosoft/source/latest" : process.argv[index + 1]));
  const privateRoot = await realpath(".petrosoft");
  if (!directory.startsWith(privateRoot + sep)) throw new Error("Source snapshots must remain inside private .petrosoft storage.");
  const manifest = JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8")) as Manifest;
  const native = JSON.parse(await readFile(resolve(directory, "native.json"), "utf8")) as NativeBackup;
  if (manifest.format !== "petrosoft-source-archive-v1" || manifest.origin !== SOURCE_ORIGIN || native.format !== "petrosoft-native-v1") throw new Error("Unsupported source snapshot.");
  if (native.sourceSha256 !== manifest.backup.sourceSha256 || sourceHash(native.tables) !== manifest.backup.tablesHash) throw new Error("The native data does not match its source manifest.");
  const workspace = await database.petrosoftWorkspace.findUniqueOrThrow({ where: { referenceCode: manifest.referenceCode }, select: { id: true } });
  const artifacts: { capture: Capture; path: string }[] = [];
  for (const capture of manifest.captures) {
    if (capture.status !== "saved" || !capture.dataFile) continue;
    if (!/^(?:(?:page|history)-[a-z0-9-]+\.json|report-\d+(?:-[a-z]+-[a-z0-9_-]+)?\.(?:json|bin))$/.test(capture.dataFile)) throw new Error("Invalid capture file path.");
    const path = await realpath(resolve(directory, capture.dataFile));
    if (!path.startsWith(directory + sep)) throw new Error("Capture file escaped the source directory.");
    if (capture.dataSha256 && createHash("sha256").update(await readFile(path)).digest("hex") !== capture.dataSha256) throw new Error("Capture file checksum mismatch.");
    artifacts.push({ capture, path });
  }
  async function* records(): AsyncGenerator<SourceRecord> {
    for (const [key, rows] of Object.entries(native.tables)) yield { kind: "native-table", key, capturedAt: manifest.capturedAt, data: { rows } };
    for (const { capture, path } of artifacts) {
      const bytes = await readFile(path);
      const body = capture.dataFile!.endsWith(".json") ? JSON.parse(bytes.toString("utf8")) : { encoding: "base64", body: bytes.toString("base64") };
      yield { kind: capture.key.startsWith("report-") ? "report" : "view", key: capture.key, capturedAt: capture.capturedAt || manifest.capturedAt,
        data: { path: capture.path, type: capture.type || "", sourceError: Boolean(capture.sourceError), body } };
    }
    yield { kind: "manifest", key: "source-run", capturedAt: manifest.capturedAt, data: manifest };
  }
  const counts = await archiveSourceRecords(database, workspace.id, manifest.referenceCode, records());
  const result = { ...counts, nativeTables: Object.keys(native.tables).length, savedCaptures: artifacts.length,
    failedCaptures: manifest.captures.filter(item => item.status === "failed").length,
    recoveredTimeouts: manifest.captures.filter(item => item.status === "failed" && item.recoveredBy?.length).length,
    unrecoveredCaptures: manifest.captures.filter(item => item.status === "failed" && !item.recoveredBy?.length).length,
    sourceErrors: manifest.captures.filter(item => item.sourceError).length, completed: Boolean(manifest.completedAt), storedAt: new Date().toISOString() };
  await writeFile(resolve(directory, "stored.json"), JSON.stringify(result), { mode: 0o600 });
  console.log(JSON.stringify(result));
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Source archive failed."); process.exitCode = 1; }).finally(() => database.$disconnect());
