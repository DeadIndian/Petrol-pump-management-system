import { Prisma, type PetrosoftEntry } from "@prisma/client";
import { fieldValue, jsonFields, type PetrosoftFields } from "./catalog";
import { referencedMaster } from "./masters";
import { BOWSER_KEYS, EMPLOYEE_KEYS, money, positive, quantity, referenceValue } from "./rules";

type Database = Prisma.TransactionClient;
const identity = (entry: Pick<PetrosoftEntry, "externalId" | "number">) => entry.externalId || String(entry.number);
const list = (fields: PetrosoftFields, name: string): unknown[] => {
  const value = fields[`${name}[]`] ?? fields[name];
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
};
const details = (fields: PetrosoftFields, name: string) => Array.isArray(fields[name]) ? (fields[name] as unknown[]).map(jsonFields) : [];

export async function bowserDependency(database: Database, workspaceId: string, entry: PetrosoftEntry) {
  if (entry.module === "meter-sales") {
    const dependent = await database.petrosoftEntry.findFirst({ where: { workspaceId, module: "bowser-sales", status: { not: "void" }, fields: { path: ["receipts"], array_contains: [{ meter_entry_id: entry.id }] } } });
    if (dependent) return "Reverse the bowser receipt before changing its station meter entry.";
  }
  if (entry.module === "bowser-sales") {
    const bowser = fieldValue(jsonFields(entry.fields), BOWSER_KEYS);
    const later = await database.petrosoftEntry.findFirst({ where: { workspaceId, module: "bowser-sales", date: { gt: entry.date }, status: { not: "void" }, fields: { path: ["bowser"], equals: bowser } } });
    if (later) return "Reverse later bowser days before changing this day's opening stock or readings.";
    const linked = await database.petrosoftEntry.findFirst({ where: { workspaceId, module: { in: ["bowser-credit-sales", "bowser-swipes", "bowser-expenses"] }, date: entry.date, status: { not: "void" }, fields: { path: ["bowser"], equals: bowser } } });
    if (linked) return "Reverse this day's bowser credit, swipe, and expense entries before changing its meter sale.";
  }
  return null;
}

export async function prepareBowserSale(database: Database, workspaceId: string, fields: PetrosoftFields, date: Date, settings: PetrosoftFields, id?: string) {
  const bowser = await referencedMaster(database, workspaceId, "bowsers", fieldValue(fields, BOWSER_KEYS));
  if (!bowser) throw new Error("Choose a bowser from this station.");
  const code = identity(bowser), properties = jsonFields(bowser.fields);
  const history = await database.petrosoftEntry.findMany({ where: { workspaceId, module: "bowser-sales", status: { not: "void" }, ...(id ? { id: { not: id } } : {}), fields: { path: ["bowser"], equals: code } }, orderBy: [{ date: "desc" }, { number: "desc" }] });
  if (history.some(entry => entry.date > date)) throw new Error("Reverse later bowser days before entering an earlier day.");
  const previous = history.find(entry => entry.date < date);
  const opening = previous ? quantity(fieldValue(jsonFields(previous.fields), "closing", "0")) : positive(fieldValue(fields, "opening", fieldValue(properties, "opening_stock", "0")), "Bowser opening stock", true);
  if (previous && !quantity(fieldValue(fields, "opening", opening.toString())).eq(opening)) throw new Error("Bowser opening stock must equal the previous day's closing stock.");

  // A station meter already records the fuel loaded into a bowser. Reclassify
  // that receipt; do not withdraw it from the station tank a second time.
  const receipts: PetrosoftFields[] = [];
  const offeredReceipts = fields["rec_noz[]"] !== undefined || fields.rec_noz !== undefined
    ? list(fields, "rec_noz").map((nozzle, index) => ({ nozzle_id: nozzle, quantity: list(fields, "rec_qty")[index] }))
    : details(fields, "receipts");
  const usedNozzles = new Set<string>();
  const otherDays = await database.petrosoftEntry.findMany({ where: { workspaceId, module: "bowser-sales", date, status: { not: "void" }, ...(id ? { id: { not: id } } : {}) } });
  const allocated = new Map<string, Prisma.Decimal>();
  for (const day of otherDays) for (const receipt of details(jsonFields(day.fields), "receipts")) {
    const meterId = fieldValue(receipt, "meter_entry_id");
    allocated.set(meterId, (allocated.get(meterId) || quantity(0)).add(fieldValue(receipt, "quantity", "0")));
  }
  for (const offered of offeredReceipts) {
    const nozzleId = fieldValue(offered, "nozzle_id");
    if (!nozzleId && !fieldValue(offered, "quantity")) continue;
    const count = positive(fieldValue(offered, "quantity", "0"), "Receipt quantity", true);
    if (count.isZero() && !nozzleId) continue;
    const nozzle = await referencedMaster(database, workspaceId, "nozzles", nozzleId, !id);
    if (!nozzle || fieldValue(jsonFields(nozzle.fields), "product") !== fieldValue(fields, "product")) throw new Error("Choose a station nozzle dispensing the bowser's product.");
    const nozzleCode = identity(nozzle);
    if (usedNozzles.has(nozzleCode)) throw new Error("Enter each receiving nozzle only once.");
    usedNozzles.add(nozzleCode);
    if (count.isZero()) continue;
    const meters = await database.petrosoftEntry.findMany({ where: { workspaceId, module: "meter-sales", date, status: { not: "void" }, fields: { path: ["nozzle_id"], equals: nozzleCode } }, orderBy: { number: "asc" } });
    let remaining = quantity(count);
    for (const meter of meters) {
      const available = quantity(meter.quantity).sub(allocated.get(meter.id) || 0);
      if (available.lte(0)) continue;
      const portion = quantity(Prisma.Decimal.min(remaining, available));
      const amount = money(portion.mul(meter.rate));
      receipts.push({ nozzle_id: nozzleCode, meter_entry_id: meter.id, quantity: portion.toString(), rate: meter.rate.toString(), amount: amount.toString(), employee: referenceValue(jsonFields(meter.fields), EMPLOYEE_KEYS) });
      allocated.set(meter.id, (allocated.get(meter.id) || quantity(0)).add(portion));
      remaining = remaining.sub(portion);
      if (remaining.isZero()) break;
    }
    if (remaining.gt(0)) throw new Error("Bowser receipt exceeds unallocated station meter sales for this nozzle and date. Save its station meter entry first.");
  }

  const nozzleSales: PetrosoftFields[] = [], usedMeters = new Set<string>();
  const offeredSales = fields["bow_nozzle[]"] !== undefined || fields.bow_nozzle !== undefined
    ? list(fields, "bow_nozzle").map((nozzle, index) => ({ nozzle_id: nozzle, open_read: list(fields, "openread")[index], close_read: list(fields, "closeread")[index], test_qty: list(fields, "test")[index], rate: list(fields, "rate")[index] }))
    : details(fields, "nozzle_sales");
  for (const offered of offeredSales) {
    const nozzleId = fieldValue(offered, "nozzle_id");
    if (!nozzleId || fieldValue(offered, "close_read") === "") continue;
    const nozzle = await referencedMaster(database, workspaceId, "bowser-nozzles", nozzleId, !id);
    if (!nozzle || fieldValue(jsonFields(nozzle.fields), ["bowser", "bowser_id"]) !== code) throw new Error("Choose a nozzle belonging to this bowser.");
    const nozzleCode = identity(nozzle);
    if (usedMeters.has(nozzleCode)) throw new Error("Enter each bowser nozzle only once.");
    usedMeters.add(nozzleCode);
    const last = history.filter(entry => entry.date < date).flatMap(entry => details(jsonFields(entry.fields), "nozzle_sales")).find(row => fieldValue(row, "nozzle_id") === nozzleCode);
    const expected = quantity(last ? fieldValue(last, "close_read", "0") : fieldValue(jsonFields(nozzle.fields), ["open_read", "opening_reading"], "0"));
    const open = positive(fieldValue(offered, "open_read", expected.toString()), "Opening meter reading", true);
    const close = positive(fieldValue(offered, "close_read", "0"), "Closing meter reading", true);
    const test = positive(fieldValue(offered, "test_qty", "0"), "Test quantity", true);
    if (!open.eq(expected)) throw new Error("Bowser opening meter reading must match its previous closing reading.");
    if (close.lt(open) || test.gt(close.sub(open))) throw new Error("Closing reading and testing must leave a nonnegative bowser sale.");
    const rate = positive(fieldValue(offered, "rate", fieldValue(fields, "price", "0")), "Bowser sale rate");
    const count = quantity(close.sub(open).sub(test));
    nozzleSales.push({ nozzle_id: nozzleCode, open_read: open.toString(), close_read: close.toString(), test_qty: test.toString(), quantity: count.toString(), rate: rate.toString(), amount: money(count.mul(rate)).toString() });
  }
  if (!nozzleSales.length) throw new Error("Enter at least one bowser nozzle's closing reading.");
  const receipt = receipts.reduce((sum, row) => sum.add(fieldValue(row, "quantity", "0")), quantity(0));
  const sold = nozzleSales.reduce((sum, row) => sum.add(fieldValue(row, "quantity", "0")), quantity(0));
  const amount = nozzleSales.reduce((sum, row) => sum.add(fieldValue(row, "amount", "0")), money(0));
  const testing = nozzleSales.reduce((sum, row) => sum.add(fieldValue(row, "test_qty", "0")), quantity(0));
  const deductTesting = Array.isArray(settings.feature_ids) && settings.feature_ids.map(String).includes("52");
  const testingLoss = deductTesting ? testing : quantity(0), closing = quantity(opening.add(receipt).sub(sold).sub(testingLoss));
  if (closing.lt(0)) throw new Error("Bowser sales and testing cannot exceed available bowser stock.");
  const capacity = quantity(fieldValue(properties, ["capacity", "b_capacity"], "0"));
  if (capacity.gt(0) && closing.gt(capacity)) throw new Error("Bowser closing stock exceeds its configured capacity.");
  return { ...fields, bowser: code, bowser_name: bowser.name, opening: opening.toString(), opening_added: previous ? "0" : opening.toString(), receipts, nozzle_sales: nozzleSales,
    receipt: receipt.toString(), receipt_amount: receipts.reduce((sum, row) => sum.add(fieldValue(row, "amount", "0")), money(0)).toString(),
    metersale: sold.toString(), quantity: sold.toString(), total_amount: amount.toString(), test_qty: testing.toString(), testing_loss: testingLoss.toString(), closing: closing.toString() };
}

export async function bowserReadings(database: Database, workspaceId: string, date: Date) {
  const [bowsers, nozzles, history] = await Promise.all([
    database.petrosoftEntry.findMany({ where: { workspaceId, module: "bowsers", status: { not: "void" } }, orderBy: { name: "asc" } }),
    database.petrosoftEntry.findMany({ where: { workspaceId, module: "bowser-nozzles", status: { not: "void" } }, orderBy: { name: "asc" } }),
    database.petrosoftEntry.findMany({ where: { workspaceId, module: "bowser-sales", date: { lt: date }, status: { not: "void" } }, orderBy: [{ date: "desc" }, { number: "desc" }] }),
  ]);
  return bowsers.map(bowser => {
    const code = identity(bowser), days = history.filter(entry => fieldValue(jsonFields(entry.fields), "bowser") === code), properties = jsonFields(bowser.fields);
    return { id: code, product: fieldValue(properties, "product"), opening: days.length ? fieldValue(jsonFields(days[0].fields), "closing", "0") : fieldValue(properties, "opening_stock", "0"), carried: Boolean(days.length),
      nozzles: nozzles.filter(nozzle => fieldValue(jsonFields(nozzle.fields), ["bowser", "bowser_id"]) === code).map(nozzle => {
        const last = days.flatMap(day => details(jsonFields(day.fields), "nozzle_sales")).find(row => fieldValue(row, "nozzle_id") === identity(nozzle));
        return { id: identity(nozzle), name: nozzle.name, opening: last ? fieldValue(last, "close_read", "0") : fieldValue(jsonFields(nozzle.fields), ["open_read", "opening_reading"], "0") };
      }) };
  });
}
