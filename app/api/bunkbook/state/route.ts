import { NextRequest, NextResponse } from "next/server";
import { requestUser } from "@/lib/bunkbook/auth";
import { readState, entryForActor } from "@/lib/bunkbook/queries";
import { BunkBookError } from "@/lib/bunkbook/actions";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const actor = await requestUser(request);
    if (!actor) return NextResponse.json({ error: "Sign in to BunkBook." }, { status: 401 });
    const id = request.nextUrl.searchParams.get("id");
    const result = id ? { entry: await entryForActor(actor, id) }
      : await readState(actor, request.nextUrl.searchParams.get("module") || "dashboard", Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load records." }, { status: error instanceof BunkBookError ? error.status : 400 });
  }
}
