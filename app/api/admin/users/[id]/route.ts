import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/auth";
import { z } from "zod";

const supabaseAdmin = createSupabaseServerClient();

const UpdateUserSchema = z.object({
	fullName: z.string().min(2).optional(),
	phone: z.string().optional().nullable(),
	role: z.enum(["CUSTOMER", "EMPLOYEE", "ADMIN"]).optional(),
	password: z.string().min(8).optional(),
});

/**
 * GET /api/admin/users/[id]
 * Get a single user's details.
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
		if (authRequest.user?.role !== "ADMIN") {
			return NextResponse.json({ error: "Forbidden" }, { status: 403 });
		}

		const user = await prisma.user.findUnique({
			where: { id: routeParams.id },
			include: {
				_count: {
					select: { orders: true },
				},
				orders: {
					orderBy: { createdAt: "desc" },
					take: 5,
					select: {
						id: true,
						status: true,
						fuelType: true,
						createdAt: true,
					},
				},
			},
		});

		if (!user) {
			return NextResponse.json({ error: "User not found" }, { status: 404 });
		}

		return NextResponse.json({ user });
	} catch (error: any) {
		console.error("Get user error:", error);
		return NextResponse.json(
			{ error: "Failed to fetch user" },
			{ status: 500 },
		);
	}
}

/**
 * PATCH /api/admin/users/[id]
 * Update a user's profile or role. Admin only.
 */
export async function PATCH(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
    const routeParams = await params;
	try {
		const authResult = await authenticate(request);
		if (authResult instanceof NextResponse) return authResult;

		const authRequest = authResult as any;
		if (authRequest.user?.role !== "ADMIN") {
			return NextResponse.json({ error: "Forbidden" }, { status: 403 });
		}

		const body = await request.json();
		const data = UpdateUserSchema.parse(body);

		const existing = await prisma.user.findUnique({ where: { id: routeParams.id } });
        if (!existing) return NextResponse.json({ error: "User not found" }, { status: 404 });
        if (authRequest.user.id === routeParams.id && data.role && data.role !== "ADMIN") {
            return NextResponse.json({ error: "You cannot remove your own admin access" }, { status: 400 });
        }
    const user = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM customer_profiles WHERE user_id = ${routeParams.id} FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id: routeParams.id }, include: {
        _count: { select: { orders: true } }, customerProfile: { include: { _count: { select: { payments: true } } } },
      } });
      if (!current) throw new Error("USER_NOT_FOUND");
      const leavingCustomer = current.role === "CUSTOMER" && data.role && data.role !== "CUSTOMER";
      if (leavingCustomer && (current._count.orders || current.customerProfile?._count.payments || current.customerProfile?.currentBalance)) {
        throw new Error("CUSTOMER_HAS_HISTORY");
      }
      if (data.password) {
        const { error } = await supabaseAdmin.auth.admin.updateUserById(routeParams.id, { password: data.password });
        if (error) throw new Error("Could not update the password. Please try again.");
      }
      if (leavingCustomer && current.customerProfile) await tx.customerProfile.delete({ where: { userId: routeParams.id } });
      return tx.user.update({ where: { id: routeParams.id }, data: {
        ...(data.fullName !== undefined && { fullName: data.fullName }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.role !== undefined && { role: data.role }),
        ...(data.role === "CUSTOMER" && { customerProfile: { upsert: { create: {}, update: {} } } }),
      }, select: { id: true, email: true, fullName: true, phone: true, role: true, updatedAt: true } });
    }, { maxWait: 15000, timeout: 30000 });

		return NextResponse.json({
			message: "User updated successfully",
			user,
		});
	} catch (error: any) {
    if (error.message === "USER_NOT_FOUND") return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (error.message === "CUSTOMER_HAS_HISTORY") return NextResponse.json({ error: "Keep customer accounts with orders or payments as customers to preserve their billing history." }, { status: 409 });
		console.error("Update user error:", error);
		if (error.code === "P2025") {
			return NextResponse.json({ error: "User not found" }, { status: 404 });
		}
		if (error.name === "ZodError") {
			return NextResponse.json(
				{ error: "Validation error", details: error.issues },
				{ status: 400 },
			);
		}
		return NextResponse.json(
			{ error: error.message || "Failed to update user" },
			{ status: 500 },
		);
	}
}

/**
 * DELETE /api/admin/users/[id]
 * Delete a user from both Supabase Auth and Prisma. Admin only.
 */
export async function DELETE(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
    const routeParams = await params;
	try {
		const authResult = await authenticate(request);
		if (authResult instanceof NextResponse) return authResult;

		const authRequest = authResult as any;
		if (authRequest.user?.role !== "ADMIN") {
			return NextResponse.json({ error: "Forbidden" }, { status: 403 });
		}

		// Prevent self-deletion
		if (authRequest.user.id === routeParams.id) {
			return NextResponse.json(
				{ error: "Cannot delete your own account" },
				{ status: 400 },
			);
		}

    await prisma.$transaction(async tx => {
      // Lock in the same order as allocation and payment writes, then check history.
      await tx.$queryRaw`SELECT id FROM customer_profiles WHERE user_id = ${routeParams.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${routeParams.id} FOR UPDATE`;
      const existing = await tx.user.findUnique({ where: { id: routeParams.id }, include: {
        _count: { select: { orders: true, fulfilledOrders: true, pricesCreated: true, auditLogs: true } },
        customerProfile: { include: { _count: { select: { payments: true } } } },
      } });
      if (!existing) throw new Error("USER_NOT_FOUND");
      if (existing._count.orders || existing._count.fulfilledOrders || existing._count.pricesCreated || existing._count.auditLogs || existing.customerProfile?._count.payments) {
        throw new Error("ACCOUNT_HAS_HISTORY");
      }
      // If the Auth provider rejects deletion, the database transaction keeps the account.
      const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(routeParams.id);
      if (authError && authError.status !== 404) throw authError;
      await tx.user.delete({ where: { id: routeParams.id } });
    }, { maxWait: 15000, timeout: 30000 });

		return NextResponse.json({ message: "User deleted successfully" });
	} catch (error: any) {
    if (error.message === "USER_NOT_FOUND") return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (error.message === "ACCOUNT_HAS_HISTORY") return NextResponse.json({ error: "Accounts with orders, deliveries, payments, prices, or audit history must be kept for the records." }, { status: 409 });
		console.error("Delete user error:", error);
		if (error.code === "P2025") {
			return NextResponse.json({ error: "User not found" }, { status: 404 });
		}
		return NextResponse.json(
			{ error: error.message || "Failed to delete user" },
			{ status: 500 },
		);
	}
}
