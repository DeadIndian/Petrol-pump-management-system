import { NextRequest, NextResponse } from "next/server";
import { authenticate, successResponse, errorResponse } from "@/lib/auth";
import { getLatestPrices } from "@/lib/db-utils";

// Keep the existing price-write URL consistent with the administration endpoints.
export { POST, PUT } from "../admin/prices/route";

/** Current effective prices are visible to every authenticated role. */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticate(request);
    if (auth instanceof NextResponse) return auth;
    return successResponse({ prices: await getLatestPrices() });
  } catch (error) {
    console.error("Price fetch error:", error);
    return errorResponse("Failed to fetch prices", 500);
  }
}
