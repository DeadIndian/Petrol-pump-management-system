import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
	authenticate,
	requireRole,
	successResponse,
	errorResponse,
} from "@/lib/auth";
import { recordPayment } from "@/lib/billing-utils";
import { z } from "zod";
import { PaginationSchema } from "@/lib/validation";

const AddPaymentSchema = z.object({
	amount: z.number().positive("Amount must be positive"),
	paymentMethod: z
		.enum(["CASH", "BANK_TRANSFER", "CHEQUE", "UPI", "OTHER"])
		.optional(),
	paymentMethodNote: z.string().optional(),
	reference: z.string().optional(),
	notes: z.string().optional(),
	paymentDate: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid payment date").optional(),
});

/**
 * POST /api/customers/[id]/payments
 * Add a payment for a customer (admins only)
 */
export async function POST(
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

		const body = await request.json();
		const validatedData = AddPaymentSchema.parse(body);

		// Get customer and their profile
		const customer = await prisma.user.findUnique({
			where: { id: routeParams.id },
			include: {
				customerProfile: true,
			},
		});

		if (!customer) {
			return errorResponse("Customer not found", 404);
		}

		if (customer.role !== "CUSTOMER") {
			return errorResponse("User is not a customer", 400);
		}

		if (!customer.customerProfile) {
			return errorResponse("Customer profile not found", 404);
		}

        const payment = await recordPayment(customer.customerProfile.id, validatedData.amount, validatedData.paymentMethod, {
            auditUserId: authRequest.user.id, paymentMethodNote: validatedData.paymentMethodNote,
            reference: validatedData.reference, notes: validatedData.notes,
            paymentDate: validatedData.paymentDate ? new Date(validatedData.paymentDate) : undefined,
        });
        const profile = await prisma.customerProfile.findUniqueOrThrow({ where: { id: customer.customerProfile.id } });

		return successResponse({
			message: "Payment added successfully",
			payment,
			newBalance: profile.currentBalance,
		});
	} catch (error: any) {
		console.error("Error adding payment:", error);
		if (error.name === "ZodError") return errorResponse("Validation error", 400, error.issues);
        return errorResponse("Could not record payment", 500);
	}
}

/**
 * GET /api/customers/[id]/payments
 * Get payment history for a customer (admins only)
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
		const limit = parseInt(searchParams.get("limit") || "50");
		const offset = parseInt(searchParams.get("offset") || "0");
        PaginationSchema.parse({ limit, offset });

		// Get customer profile
		const customer = await prisma.user.findUnique({
			where: { id: routeParams.id },
			include: {
				customerProfile: true,
			},
		});

		if (!customer || !customer.customerProfile) {
			return errorResponse("Customer profile not found", 404);
		}

		// Get payments
		const [payments, total] = await Promise.all([
			prisma.payment.findMany({
				where: {
					customerProfileId: customer.customerProfile.id,
				},
				orderBy: { paymentDate: "desc" },
				take: limit,
				skip: offset,
			}),
			prisma.payment.count({
				where: {
					customerProfileId: customer.customerProfile.id,
				},
			}),
		]);

		return successResponse({
			payments,
			pagination: {
				total,
				limit,
				offset,
				hasMore: offset + limit < total,
			},
		});
	} catch (error: any) {
		if (error.name === "ZodError") return errorResponse("Invalid payment filters", 400);
        console.error("Error fetching payments:", error);
		return errorResponse(error.message || "Failed to fetch payments", 500);
	}
}
