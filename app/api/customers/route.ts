import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PaginationSchema } from "@/lib/validation";
import {
	authenticate,
	requireRole,
	successResponse,
	errorResponse,
} from "@/lib/auth";

/**
 * GET /api/customers
 * Get all customers with their profiles and balances (admins only)
 */
export async function GET(request: NextRequest) {
	try {
		const authResult = await authenticate(request);
		if (authResult instanceof NextResponse) return authResult;

		const authRequest = authResult as any;
		const roleCheck = requireRole("ADMIN")(authRequest);
		if (roleCheck) return roleCheck;

		const { searchParams } = new URL(request.url);
		const search = searchParams.get("search") || "";
		const limit = parseInt(searchParams.get("limit") || "50");
		const offset = parseInt(searchParams.get("offset") || "0");
        PaginationSchema.parse({ limit, offset });

		// Build where clause for search
		const where: any = {
			role: "CUSTOMER",
		};

		if (search) {
			where.OR = [
				{ fullName: { contains: search, mode: "insensitive" } },
				{ email: { contains: search, mode: "insensitive" } },
				{ phone: { contains: search, mode: "insensitive" } },
			];
		}

		// Get customers with their profiles
		const [customers, total, totalCustomers] = await Promise.all([
			prisma.user.findMany({
				where,
				include: {
					customerProfile: true,
					_count: {
						select: {
							orders: true,
						},
					},
				},
				orderBy: { createdAt: "desc" },
				take: limit,
				skip: offset,
			}),
			prisma.user.count({ where }),
      prisma.user.count({ where: { role: "CUSTOMER" } }),
		]);

		// Calculate summary statistics
		const totalBalance = await prisma.customerProfile.aggregate({
			_sum: {
				currentBalance: true,
			},
		});

		const totalOwed = await prisma.customerProfile.aggregate({
			where: {
				currentBalance: {
					lt: 0,
				},
			},
			_sum: {
				currentBalance: true,
			},
		});

		return successResponse({
			customers,
			pagination: {
				total,
				limit,
				offset,
				hasMore: offset + limit < total,
			},
			summary: {
				totalCustomers,
				totalOutstanding: Math.abs(totalOwed._sum.currentBalance || 0),
				totalBalance: totalBalance._sum.currentBalance || 0,
			},
		});
	} catch (error: any) {
		if (error.name === "ZodError") return errorResponse("Invalid customer filters", 400);
        console.error("Error fetching customers:", error);
		return errorResponse(error.message || "Failed to fetch customers", 500);
	}
}
