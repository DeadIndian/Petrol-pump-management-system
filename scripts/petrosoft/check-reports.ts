import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

config({ path: ".env.petrosoft.local", quiet: true });

async function main() {
  const [{ petrosoftDb: db }, { buildReport, reportSpecs }, { projectedReport }] = await Promise.all([import("../../lib/petrosoft/db"), import("../../lib/petrosoft/report-data"), import("../../lib/petrosoft/report-render")]);
  try {
    const workspace = await db.petrosoftWorkspace.findFirst({ where: { referenceCode: process.env.PETROSOFT_REFERENCE_CODE || "BZ2035764" } });
    if (!workspace) throw new Error("Initialize the local Petrosoft station before comparing reports.");
    const actor = await db.petrosoftUser.findFirstOrThrow({ where: { workspaceId: workspace.id, active: true }, include: { workspace: true } });
    const requests = JSON.parse(await readFile(".petrosoft/report-requests.json", "utf8")) as { index: number; fields: Record<string, string[]> }[];
    const directory = ".petrosoft/report-checks";
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const results = [];
    for (const spec of reportSpecs) {
      const request = requests.find(request => request.index === spec.index);
      try {
        const report = projectedReport(await buildReport(actor, spec.index, request?.fields || {}));
        await writeFile(join(directory, `${spec.index}.json`), JSON.stringify(report), { mode: 0o600 });
        results.push({ index: spec.index, title: spec.title, sections: report.sections.length, rows: report.sections.reduce((sum, section) => sum + section.rows.length, 0), layouts: report.sections.map(section => section.columns.length) });
      } catch (error) {
        results.push({ index: spec.index, title: spec.title, error: error instanceof Error ? error.message : "Report failed." });
      }
    }
    await writeFile(join(directory, "summary.json"), JSON.stringify(results), { mode: 0o600 });
    console.log(JSON.stringify({ checked: results.length, failures: results.filter(result => "error" in result), empty: results.filter(result => "rows" in result && !result.rows).map(result => result.index) }));
  } finally { await db.$disconnect(); }
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Report comparison failed."); process.exitCode = 1; });
