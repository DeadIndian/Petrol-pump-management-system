import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
	authenticate,
	requireRole,
	successResponse,
	errorResponse,
} from "@/lib/auth";
import { CreatePaymentSchema, PaymentFilterSchema } from "@/lib/validation";
import { recordPayment } from "@/lib/billing-utils";

/**
 * POST /api/bills
 * Record a customer payment (admins only).
 * This endpoint replaces the old bill-generation flow.
 * Orders are now completed inline via PATCH /api/orders/[id].
 */
export async function POST(request: NextRequest) {
	try {
		const authResult = await authenticate(request);
		if (authResult instanceof NextResponse) return authResult;

		const authRequest = authResult as any;
		const roleCheck = requireRole("ADMIN")(authRequest);
		if (roleCheck) return roleCheck;

		const body = await request.json();
		const validatedData = CreatePaymentSchema.parse(body);

		const payment = await recordPayment(
			validatedData.customerProfileId,
			validatedData.amount,
			validatedData.paymentMethod as any,
			{
				auditUserId: authRequest.user.id,
                paymentMethodNote: validatedData.paymentMethodNote,
				reference: validatedData.reference,
				notes: validatedData.notes,
				paymentDate: validatedData.paymentDate
					? new Date(validatedData.paymentDate)
					: undefined,
			},
		);

		return successResponse(
			{ message: "Payment recorded successfully", payment },
			201,
		);
	} catch (error: any) {
		console.error("Payment recording error:", error);
		if (error.name === "ZodError") {
			return errorResponse("Validation error", 400, error.errors);
		}
		return errorResponse(error.message || "Failed to record payment", 500);
	}
}

/**
 * GET /api/bills
 * List all payments (admins only)
 */
export async function GET(request: NextRequest) {
	try {
		const authResult = await authenticate(request);
		if (authResult instanceof NextResponse) return authResult;

		const authRequest = authResult as any;
		const roleCheck = requireRole("ADMIN", "CUSTOMER")(authRequest);
		if (roleCheck) return roleCheck;

		const { searchParams } = new URL(request.url);
		const customerProfileId = searchParams.get("customerProfileId");
		const paymentMethod = searchParams.get("paymentMethod");
		const startDate = searchParams.get("startDate");
		const endDate = searchParams.get("endDate");
		const filters = PaymentFilterSchema.parse({ paymentMethod: paymentMethod || undefined,
            limit: Number(searchParams.get("limit") || "20"), offset: Number(searchParams.get("offset") || "0") });
        const { limit, offset } = filters;

		const where: any = {};
        if (authRequest.user.role === "CUSTOMER") {
            const profile = await prisma.customerProfile.findUnique({ where: { userId: authRequest.user.id } });
            if (!profile) return errorResponse("Customer profile not found", 404);
            if (customerProfileId && customerProfileId !== profile.id) return errorResponse("Unauthorized", 403);
            where.customerProfileId = profile.id;
        }
		if (customerProfileId) where.customerProfileId = customerProfileId;
		if (paymentMethod) where.paymentMethod = paymentMethod;
		if (startDate || endDate) {
			where.paymentDate = {};
			if (startDate) where.paymentDate.gte = new Date(startDate);
			if (endDate) where.paymentDate.lte = new Date(endDate);
		}

		const [payments, total] = await Promise.all([
			prisma.payment.findMany({
				where,
				include: {
					customerProfile: {
						include: {
							user: {
								select: {
									id: true,
									fullName: true,
									email: true,
									phone: true,
								},
							},
						},
					},
				},
				orderBy: { paymentDate: "desc" },
				take: limit,
				skip: offset,
			}),
			prisma.payment.count({ where }),
		]);

		return successResponse({
			payments,
			pagination: {
				total,
				limit,
				offset,
				page: Math.floor(offset / limit) + 1,
				pages: Math.ceil(total / limit),
			},
		});
	} catch (error: any) {
		if (error.name === "ZodError") return errorResponse("Invalid payment filters", 400, error.errors);
        console.error("Payments fetch error:", error);
		return errorResponse("Failed to fetch payments", 500);
	}
}
