import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import { getPriceHistory } from "@/lib/db-utils";

export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ fuelType: string }> },
) {
    const routeParams = await params;
	try {
		const authResult = await authenticate(request);
		if (authResult instanceof NextResponse) return authResult;
		const authRequest = authResult as any;
		if (authRequest.user?.role !== "ADMIN") {
			return NextResponse.json(
				{ error: "Admin access required" },
				{ status: 403 },
			);
		}

		// Get query parameters
		const searchParams = request.nextUrl.searchParams;
		const days = parseInt(searchParams.get("days") || "30");

		if (days < 1 || days > 365) {
			return NextResponse.json(
				{ error: "Days must be between 1 and 365" },
				{ status: 400 },
			);
		}

		// Validate fuel type
		const validFuelTypes = ["PETROL", "DIESEL"];
		if (!validFuelTypes.includes(routeParams.fuelType.toUpperCase())) {
			return NextResponse.json({ error: "Invalid fuel type" }, { status: 400 });
		}

		// Get price history
		const history = await getPriceHistory(
			routeParams.fuelType.toUpperCase() as any,
			days,
		);

		return NextResponse.json(
			{
				fuelType: routeParams.fuelType.toUpperCase(),
				days,
				count: history.length,
				history,
			},
			{ status: 200 },
		);
	} catch (error: any) {
		console.error("Get history error:", error);
		return NextResponse.json(
			{
				error: error.message || "Failed to fetch price history",
			},
			{ status: 500 },
		);
	}
}
