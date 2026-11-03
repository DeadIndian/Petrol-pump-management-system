/**
 * Admin Dashboard API Utilities
 */

import { prisma } from "@/lib/prisma";

export async function getDashboardStats() {
	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const [
		totalOrders,
		pendingOrders,
		deliveredTodayOrders,
		totalRevenue,
		activeEmployees,
		totalOutstanding,
	] = await Promise.all([
		prisma.order.count(),
		prisma.order.count({ where: { status: "PENDING" } }),
		prisma.order.count({
			where: { status: "DELIVERED", deliveredAt: { gte: today } },
		}),
		prisma.order.aggregate({
			where: {
				status: { in: ["DELIVERED", "COMPLETED"] },
				totalAmount: { not: null },
			},
			_sum: { totalAmount: true },
		}),
		prisma.user.count({ where: { role: "EMPLOYEE" } }),
		prisma.customerProfile.aggregate({
			where: { currentBalance: { lt: 0 } },
			_sum: { currentBalance: true },
		}),
	]);

	return {
		totalOrders,
		pendingOrders,
		deliveredTodayOrders,
		totalRevenue: totalRevenue._sum.totalAmount ?? 0,
		activeEmployees,
		totalOutstanding: Math.abs(totalOutstanding._sum.currentBalance ?? 0),
		pendingCashAdvances: 0,
		totalCashAdvanced: 0,
	};
}

export async function getOrdersForDashboard(
	limit: number = 10,
	offset: number = 0,
	status?: "PENDING" | "DELIVERED" | "COMPLETED",
) {
	const where = status ? { status } : undefined;

	const [orders, total] = await Promise.all([
		prisma.order.findMany({
			where,
			include: {
				customer: {
					select: { id: true, fullName: true, email: true, phone: true },
				},
			},
			orderBy: { createdAt: "desc" },
			take: limit,
			skip: offset,
		}),
		prisma.order.count({ where }),
	]);

	return {
		orders,
		total,
		page: Math.floor(offset / limit) + 1,
		pageSize: limit,
	};
}

export async function getPaymentsForDashboard(
	limit: number = 10,
	offset: number = 0,
) {
	const [payments, total] = await Promise.all([
		prisma.payment.findMany({
			include: {
				customerProfile: {
					include: {
						user: {
							select: { id: true, fullName: true, email: true },
						},
					},
				},
			},
			orderBy: { paymentDate: "desc" },
			take: limit,
			skip: offset,
		}),
		prisma.payment.count(),
	]);

	return {
		payments,
		total,
		page: Math.floor(offset / limit) + 1,
		pageSize: limit,
	};
}

export async function getOutstandingCustomersForDashboard(limit: number = 10) {
	const profiles = await prisma.customerProfile.findMany({
		where: { currentBalance: { lt: 0 } },
		include: {
			user: {
				select: { id: true, fullName: true, email: true, phone: true },
			},
		},
		orderBy: { currentBalance: "asc" },
		take: limit,
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

export async function getPriceStatusForDashboard() {
	const fuelTypes = ["PETROL", "DIESEL"] as const;

	return Promise.all(
		fuelTypes.map(async (fuelType) => {
			const latestPrice = await prisma.fuelPrice.findFirst({
				where: { fuelType },
				orderBy: { date: "desc" },
				select: { pricePerLiter: true, date: true },
			});

			if (!latestPrice) {
				return {
					fuelType,
					currentPrice: null,
					lastUpdated: null,
					needsUpdate: true,
					hoursOverdue: 24,
				};
			}

			const hoursSinceUpdate = Math.floor(
				(Date.now() - new Date(latestPrice.date).getTime()) / (1000 * 60 * 60),
			);

			return {
				fuelType,
				currentPrice: latestPrice.pricePerLiter,
				lastUpdated: latestPrice.date,
				needsUpdate: hoursSinceUpdate > 24,
				hoursOverdue: Math.max(0, hoursSinceUpdate - 24),
			};
		}),
	);
}

export async function getRevenueTrend(days: number = 30) {
	const startDate = new Date();
	startDate.setDate(startDate.getDate() - days);
	startDate.setHours(0, 0, 0, 0);

	const rows = await prisma.$queryRaw<{ date: string; revenue: number }[]>`
		SELECT
			DATE(completed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::text AS date,
			COALESCE(SUM(total_amount), 0)::float AS revenue
		FROM orders
		WHERE completed_at >= ${startDate}
		  AND status = 'COMPLETED'
		  AND total_amount IS NOT NULL
		GROUP BY DATE(completed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')
		ORDER BY date ASC
	`;

	return rows.map((r) => ({ date: r.date, revenue: Number(r.revenue) }));
}
