import assert from "node:assert/strict";
import { after, test } from "node:test";
import { archiveSourceRecords, SOURCE_ARCHIVE_TABLE, type SourceRecord } from "../../lib/bunkbook/source-archive";
import { ids, runtime, station } from "./helpers";

after(async () => { const api = await runtime(); await api.db.$disconnect(); });

test("source copies preserve operational sales and balances, redact secrets, and survive concurrent replay without duplicates", async () => {
  const s = await station();
  try {
    const date = "2026-01-03";
    const sale = ids(await s.submit("credit-sales", { insert_date: date, organiz: "1", product: "1", price: "100", qnty: "2", credsale_emp: "1" }))[0];
    const before = await s.balanceMap(new Date(date));
    const rows: SourceRecord[] = [{ kind: "native-table", key: "fixture_credit", capturedAt: "2026-01-04T00:00:00Z",
      data: { rows: [{ id: "1", amount: "9999", password: "fixture-secret", nested: { old_pwd: "fixture-secret", note: "retained" } }], cells: [["Date", "Amount"], [date, "9999"]] } }];
    const results = await Promise.all([archiveSourceRecords(s.db, rows), archiveSourceRecords(s.db, rows)]);
    assert.equal(results.reduce((sum, item) => sum + item.stored, 0), 1);
    assert.equal(await s.db.bunkBookNativeRecord.count({ where: { tableName: SOURCE_ARCHIVE_TABLE } }), 1);
    assert.equal((await s.entry(sale)).amount.toString(), "200");
    assert.deepEqual(await s.balanceMap(new Date(date)), before);
    const copy = await s.db.bunkBookNativeRecord.findFirstOrThrow({ where: { tableName: SOURCE_ARCHIVE_TABLE } });
    const data = (copy.fields as { data: { rows: { amount: string; nested: { note: string } }[]; cells: string[][] } }).data;
    assert.deepEqual(data.cells, [["Date", "Amount"], [date, "9999"]]);
    assert.deepEqual(data.rows[0], { id: "1", amount: "9999", nested: { note: "retained" } });
    assert.equal((await archiveSourceRecords(s.db, rows)).stored, 0);
  } finally { await s.cleanup(); }
});
