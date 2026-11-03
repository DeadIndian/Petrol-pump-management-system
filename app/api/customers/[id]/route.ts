import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrderFilterSchema } from "@/lib/validation";
import {
	authenticate,
	requireRole,
	successResponse,
	errorResponse,
} from "@/lib/auth";

/**
 * GET /api/customers/[id]
 * Get customer details with orders and payments (admins only)
 */
export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
    const routeParams = await params;
	try {
		const authResult = await authenticate(request);
		if (authResult instanceof NextResponse) return authResult;

		const authRequest = authResult as any;
		const roleCheck = requireRole("ADMIN")(authRequest);
		if (roleCheck) return roleCheck;

		const { searchParams } = new URL(request.url);
		const status = searchParams.get("status"); // PENDING, DELIVERED, COMPLETED
		const vehicleNumber = searchParams.get("vehicleNumber");
		const startDate = searchParams.get("startDate");
		const endDate = searchParams.get("endDate");
		const limit = parseInt(searchParams.get("limit") || "100");
		const offset = parseInt(searchParams.get("offset") || "0");
        OrderFilterSchema.parse({ status: status || undefined, limit, offset });
        if ([startDate, endDate].some(value => value && Number.isNaN(Date.parse(value)))) return errorResponse("Invalid date filter", 400);

		// Get customer
		const customer = await prisma.user.findUnique({
			where: { id: routeParams.id },
			include: {
				customerProfile: {
					include: {
						payments: {
							orderBy: { paymentDate: "desc" },
							take: 20,
						},
					},
				},
			},
		});

		if (!customer) {
			return errorResponse("Customer not found", 404);
		}

		if (customer.role !== "CUSTOMER") {
			return errorResponse("User is not a customer", 400);
		}

		// Build where clause for orders
		const orderWhere: any = {
			customerId: routeParams.id,
		};

		if (status) {
			orderWhere.status = status;
		}

		if (vehicleNumber) {
			orderWhere.vehicleNumber = {
				contains: vehicleNumber,
				mode: "insensitive",
			};
		}

		if (startDate || endDate) {
			orderWhere.createdAt = {};
			if (startDate) {
				orderWhere.createdAt.gte = new Date(`${startDate}T00:00:00+05:30`);
			}
			if (endDate) {
				orderWhere.createdAt.lt = new Date(new Date(`${endDate}T00:00:00+05:30`).getTime() + 86400000);
			}
		}

		// Get orders
		const [orders, totalOrders] = await Promise.all([
			prisma.order.findMany({
				where: orderWhere,
				orderBy: { createdAt: "desc" },
				take: limit,
				skip: offset,
			}),
			prisma.order.count({ where: orderWhere }),
		]);

		// Get unique vehicle numbers for this customer
		const vehicles = await prisma.order.groupBy({
			by: ["vehicleNumber"],
			where: {
				customerId: routeParams.id,
			},
			_count: {
				id: true,
			},
			orderBy: {
				_count: {
					id: "desc",
				},
			},
		});

		return successResponse({
			customer,
			orders,
			vehicles: vehicles.map((v) => ({
				vehicleNumber: v.vehicleNumber,
				orderCount: v._count.id,
			})),
			pagination: {
				total: totalOrders,
				limit,
				offset,
				hasMore: offset + limit < totalOrders,
			},
		});
	} catch (error: any) {
		if (error.name === "ZodError") return errorResponse("Invalid order filters", 400);
        console.error("Error fetching customer details:", error);
		return errorResponse(
			error.message || "Failed to fetch customer details",
			500,
		);
	}
}
