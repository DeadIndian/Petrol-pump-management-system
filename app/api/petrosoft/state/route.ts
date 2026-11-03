import { NextRequest, NextResponse } from "next/server";
import { requestUser } from "@/lib/petrosoft/auth";
import { readState, entryForActor } from "@/lib/petrosoft/queries";
import { PetrosoftError } from "@/lib/petrosoft/actions";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const actor = await requestUser(request);
    if (!actor) return NextResponse.json({ error: "Sign in to Petrosoft." }, { status: 401 });
    const id = request.nextUrl.searchParams.get("id");
    const result = id ? { entry: await entryForActor(actor, id) }
      : await readState(actor, request.nextUrl.searchParams.get("module") || "dashboard", Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load records." }, { status: error instanceof PetrosoftError ? error.status : 400 });
  }
}
