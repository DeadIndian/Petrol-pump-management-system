import { NextRequest, NextResponse } from "next/server";
import { authenticated, apiError } from "@/lib/petrosoft/http";
import { calculateDip, densityAt15 } from "@/lib/petrosoft/calculations";
import { jsonFields } from "@/lib/petrosoft/catalog";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const actor = await authenticated(request, true), input = jsonFields(await request.json());
    return NextResponse.json(input.operation === "density" ? densityAt15(input) : await calculateDip(actor, input));
  } catch (error) { return apiError(error); }
}
