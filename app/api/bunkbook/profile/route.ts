import { NextRequest, NextResponse } from "next/server";
import { authenticated, apiError } from "@/lib/bunkbook/http";
import { bunkbookDb } from "@/lib/bunkbook/db";
import { transaction } from "@/lib/bunkbook/actions";
import { fieldValue, jsonFields } from "@/lib/bunkbook/catalog";
import { safeFields } from "@/lib/bunkbook/rules";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const actor = await authenticated(request, true), fields = jsonFields(await request.json());
    const name = fieldValue(fields, ["full_name", "name", "firstname", "first_name", "user_name"], actor.fullName).trim();
    if (!name || name.length > 150) throw new Error("Enter a name between 1 and 150 characters.");
    await transaction(async database => {
      await database.bunkBookUser.update({ where: { id: actor.id }, data: { fullName: name } });
      const entry = await database.bunkBookEntry.findFirst({ where: { module: "users", OR: [{ name: actor.username }, { fields: { path: ["user_name"], equals: actor.username } }] } });
      if (entry) await database.bunkBookEntry.update({ where: { id: entry.id }, data: { fields: safeFields({ ...jsonFields(entry.fields), full_name: name, email: fieldValue(fields, "email"), phone: fieldValue(fields, ["phone", "mobile"]), attachment_id: fieldValue(fields, ["attachment_id", "profile_image"]) }) } });
      await database.bunkBookAudit.create({ data: { userId: actor.id, username: actor.username, module: "profile", action: "PROFILE_UPDATED" } });
    });
    return NextResponse.json({ message: "Profile saved.", fullName: name });
  } catch (error) { return apiError(error); }
}
export async function GET(request: NextRequest) {
  try {
    const actor = await authenticated(request), entry = await bunkbookDb.bunkBookEntry.findFirst({ where: { module: "users", name: actor.username } });
    const fields = jsonFields(entry?.fields);
    return NextResponse.json({ username: actor.username, fullName: actor.fullName, role: actor.role, email: fieldValue(fields, "email"), phone: fieldValue(fields, "phone"), attachment_id: fieldValue(fields, "attachment_id") }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
