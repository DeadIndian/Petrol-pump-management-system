/**
 * Billing / Payment System
 *
 * Customer balance model:
 *   - When an order is COMPLETED the balance is DECREMENTED by totalAmount
 *   - When a payment is recorded the balance is INCREMENTED (debt reduced)
 *   - Negative balance → customer owes money
 *   - Positive balance → customer has credit
 */

import { prisma } from "@/lib/prisma";
import { PaymentMethod } from "@prisma/client";

// ─── Record Payment ────────────────────────────────────────────────────────────

/**
 * Record a customer payment and update their running balance.
 */
export async function recordPayment(
	customerProfileId: string,
	amount: number,
	paymentMethod?: PaymentMethod,
	options?: {
		paymentMethodNote?: string;
		reference?: string;
		notes?: string;
		paymentDate?: Date;
        auditUserId?: string;
	},
) {
	const profile = await prisma.customerProfile.findUnique({
		where: { id: customerProfileId },
	});

	if (!profile) {
		throw new Error(`Customer profile not found: ${customerProfileId}`);
	}

	return prisma.$transaction(async (tx) => {
		const payment = await tx.payment.create({
			data: {
				customerProfileId,
				amount,
				paymentMethod,
				paymentMethodNote: options?.paymentMethodNote,
				reference: options?.reference,
				notes: options?.notes,
				paymentDate: options?.paymentDate ?? new Date(),
			},
			include: {
				customerProfile: {
					include: {
						user: {
							select: { id: true, fullName: true, email: true },
						},
					},
				},
			},
		});

		await tx.customerProfile.update({
			where: { id: customerProfileId },
			data: {
				currentBalance: { increment: amount },
				totalPayments: { increment: amount },
			},
		});

        if (options?.auditUserId) await tx.auditLog.create({ data: {
            userId: options.auditUserId, action: "PAYMENT_RECORDED", tableName: "payments", recordId: payment.id,
            changes: JSON.stringify({ customerProfileId, amount, paymentMethod }),
        } });
		return payment;
	});
}

// ─── Reverse Payment ───────────────────────────────────────────────────────────

/**
 * Reverse a previously recorded payment and restore the customer's debt.
 */
export async function reversePayment(paymentId: string, auditUserId?: string) {
	const payment = await prisma.payment.findUnique({ where: { id: paymentId } });

	if (!payment) {
		throw new Error(`Payment not found: ${paymentId}`);
	}

	await prisma.$transaction(async (tx) => {
		await tx.payment.delete({ where: { id: paymentId } });
		await tx.customerProfile.update({
			where: { id: payment.customerProfileId },
			data: {
				currentBalance: { decrement: payment.amount },
				totalPayments: { decrement: payment.amount },
			},
		});
        if (auditUserId) await tx.auditLog.create({ data: {
            userId: auditUserId, action: "PAYMENT_REVERSED", tableName: "payments", recordId: paymentId,
            changes: JSON.stringify({ customerProfileId: payment.customerProfileId, amount: payment.amount }),
        } });
	});

	return payment;
}

// ─── Customer Balance Summary ──────────────────────────────────────────────────

export async function getCustomerBalanceSummary(userId: string) {
	const profile = await prisma.customerProfile.findUnique({
		where: { userId },
		include: {
			user: { select: { id: true, fullName: true, email: true } },
			payments: { orderBy: { paymentDate: "desc" }, take: 10 },
		},
	});

	if (!profile) {
		throw new Error(`Customer profile not found for user: ${userId}`);
	}

	return {
		userId,
		customerProfileId: profile.id,
		currentBalance: profile.currentBalance,
		totalOrders: profile.totalOrders,
		totalPurchases: profile.totalPurchases,
		totalPayments: profile.totalPayments,
		outstanding: Math.max(0, -profile.currentBalance),
		credit: Math.max(0, profile.currentBalance),
		recentPayments: profile.payments,
	};
}

// ─── Outstanding Balances ──────────────────────────────────────────────────────

export async function getOutstandingBalances() {
	const profiles = await prisma.customerProfile.findMany({
		where: { currentBalance: { lt: 0 } },
		include: {
			user: {
				select: { id: true, fullName: true, email: true, phone: true },
			},
		},
		orderBy: { currentBalance: "asc" },
	});

	return profiles.map((p) => ({
		customerProfileId: p.id,
		userId: p.userId,
		fullName: p.user.fullName,
		email: p.user.email,
		phone: p.user.phone,
		currentBalance: p.currentBalance,
		outstanding: Math.abs(p.currentBalance),
		totalPurchases: p.totalPurchases,
		totalPayments: p.totalPayments,
	}));
}

// ─── Legacy no-ops (kept so old imports don't break at compile time) ───────────
/** @deprecated Bills no longer exist in the schema; use recordPayment instead */
export async function generateBill(_orderId: string, _createdBy: string) {
	throw new Error("Bills have been removed. Use recordPayment() instead.");
}

/** @deprecated Bills no longer exist in the schema; use recordPayment instead */
export async function markBillAsPaid(
	_billId: string,
	_paidBy: string,
	_paymentMethod?: string,
) {
	throw new Error("Bills have been removed. Use recordPayment() instead.");
}
