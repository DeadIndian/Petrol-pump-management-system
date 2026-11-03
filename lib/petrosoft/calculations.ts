import { petrosoftDb } from "./db";
import { fieldNumber, fieldValue, jsonFields, type PetrosoftFields } from "./catalog";
import { hasPermission, type PetrosoftActor } from "./auth";
import { PetrosoftError } from "./actions";

export async function calculateDip(actor: PetrosoftActor, fields: PetrosoftFields) {
  const moduleSchema = fieldValue(fields, "module", "opening-stock");
  if (!hasPermission(actor, moduleSchema)) throw new PetrosoftError("Your role cannot open tank calculations.", 403);
  const tankNo = fieldValue(fields, ["tank_no", "tank"]);
  const tank = await petrosoftDb.petrosoftEntry.findFirst({ where: { workspaceId: actor.workspaceId, module: "tanks", status: { not: "void" }, OR: [{ externalId: tankNo }, { fields: { path: ["tank_no"], equals: tankNo } }] } });
  if (!tank) throw new Error("Choose a valid tank.");
  const capacity = fieldValue(jsonFields(tank.fields), "tank_cap").replace(/\D/g, ""), normalized = Number(capacity) >= 1000 ? Number(capacity) / 1000 : Number(capacity);
  const tableName = `k_calbrichat${normalized}kl`;
  const records = await petrosoftDb.petrosoftNativeRecord.findMany({ where: { workspaceId: actor.workspaceId, tableName } });
  const chart = records.map(record => ({ dip: fieldNumber(jsonFields(record.fields), "dip_value"), stock: fieldNumber(jsonFields(record.fields), "prodvolum") })).sort((a, b) => a.dip - b.dip);
  if (!chart.length) throw new Error("No calibration chart is installed for this tank capacity.");
  chart.unshift({ dip: 0, stock: 0 });
  const inverse = fields.stock !== undefined, value = fieldNumber(fields, inverse ? "stock" : "dip"), key = inverse ? "stock" : "dip", out = inverse ? "dip" : "stock";
  if (value < 0 || value > chart.at(-1)![key]) throw new Error(`Enter a ${key} between 0 and ${chart.at(-1)![key]}.`);
  const upper = chart.findIndex(point => point[key] >= value), high = chart[upper], low = chart[Math.max(0, upper - 1)];
  const answer = high[key] === low[key] ? low[out] : low[out] + (value - low[key]) / (high[key] - low[key]) * (high[out] - low[out]);
  return { tank_no: fieldValue(jsonFields(tank.fields), "tank_no", tankNo), [out]: Number(answer.toFixed(2)), [key]: value };
}
export function densityAt15(fields: PetrosoftFields) {
  const temperature = fieldNumber(fields, "temperature"), density = fieldNumber(fields, "hydrometer");
  if (temperature < -20 || temperature > 80 || density < 600 || density > 1000) throw new Error("Enter temperature from -20 to 80 °C and hydrometer density from 600 to 1,000 kg/m³.");
  const gasoline = fieldValue(fields, "product_type").toLowerCase().includes("petrol"), k0 = gasoline ? 346.4228 : 186.9696, k1 = gasoline ? 0.4388 : 0.4862;
  let reference = density;
  for (let index = 0; index < 8; index++) { const alpha = k0 / reference ** 2 + k1 / reference, delta = temperature - 15; reference = density / Math.exp(-alpha * delta * (1 + 0.8 * alpha * delta)); }
  return { density: Number(reference.toFixed(2)), reference_temperature: 15 };
}
