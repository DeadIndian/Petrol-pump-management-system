import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, successResponse, errorResponse } from "@/lib/auth";

import { businessDate } from "@/lib/dates";
import { z } from "zod";

/**
 * GET /api/prices/history
 * Get effective price history for any authenticated role
 */
export async function GET(request: NextRequest) {
	try {
		const authResult = await authenticate(request);
		if (authResult instanceof NextResponse) return authResult;
		const { searchParams } = new URL(request.url);
		const fuelType = searchParams.get("fuelType");
		const limit = Math.min(parseInt(searchParams.get("limit") || "30"), 365);
		const offset = parseInt(searchParams.get("offset") || "0");

		const query = z.object({ fuelType: z.enum(["PETROL", "DIESEL"]).optional(), limit: z.number().int().min(1).max(365), offset: z.number().int().min(0) }).parse({ fuelType: fuelType || undefined, limit, offset });
        const where: any = { date: { lte: businessDate() } };
		if (fuelType) {
			where.fuelType = query.fuelType;
		}

		const [prices, total] = await Promise.all([
			prisma.fuelPrice.findMany({
				where,
				orderBy: { date: "desc" },
				take: limit,
				skip: offset,
			}),
			prisma.fuelPrice.count({ where }),
		]);

		return successResponse({
			prices,
			pagination: {
				total,
				limit,
				offset,
				page: Math.floor(offset / limit) + 1,
				pages: Math.ceil(total / limit),
			},
		});
	} catch (error: any) {
		if (error.name === "ZodError") return errorResponse("Invalid price filters", 400);
        console.error("Price history fetch error:", error);
		return errorResponse("Failed to fetch price history", 500);
	}
}
