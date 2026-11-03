import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/auth";
import { businessDate, businessDayStart } from "@/lib/dates";
import { getRevenueTrend } from "@/lib/dashboard-utils";

/**
 * GET /api/admin/stats
 * Returns real-time dashboard statistics for the admin overview.
 * Requires ADMIN role.
 */
export async function GET(request: NextRequest) {
	try {
		const authResult = await authenticate(request);
		if (authResult instanceof NextResponse) return authResult;

		const authRequest = authResult as any;
		if (authRequest.user?.role !== "ADMIN") {
			return NextResponse.json({ error: "Forbidden" }, { status: 403 });
		}

		const now = new Date();
        const calendar = businessDate(now);
        const startOfToday = businessDayStart(now);
        const startOfWeek = new Date(startOfToday.getTime() - 6 * 86400000);
        const startOfMonth = new Date(Date.UTC(calendar.getUTCFullYear(), calendar.getUTCMonth(), 1) - 19800000);
        const startOfLastMonth = new Date(Date.UTC(calendar.getUTCFullYear(), calendar.getUTCMonth() - 1, 1) - 19800000);
        const endOfLastMonth = new Date(startOfMonth.getTime() - 1);

		// Run all queries concurrently
		const [
			totalOrders,
			pendingOrders,
			totalRevenue,
			lastMonthRevenue,
			employeeCount,
			todayOrders,
			weekOrdersByDay,
			orderStatusCounts,
		] = await Promise.all([
			// All-time order count
			prisma.order.count(),

			// Currently pending orders
			prisma.order.count({ where: { status: "PENDING" } }),

			// Total revenue from delivered/completed orders
			prisma.order.aggregate({
				where: {
					status: { in: ["DELIVERED", "COMPLETED"] },
					totalAmount: { not: null },
				},
				_sum: { totalAmount: true },
			}),

			// Last month revenue for trend (based on delivery date)
			prisma.order.aggregate({
				where: {
					status: { in: ["DELIVERED", "COMPLETED"] },
					deliveredAt: { gte: startOfLastMonth, lte: endOfLastMonth },
					totalAmount: { not: null },
				},
				_sum: { totalAmount: true },
			}),

			// Employee count
			prisma.user.count({ where: { role: "EMPLOYEE" } }),

			// Today's orders
			prisma.order.count({
				where: { createdAt: { gte: startOfToday } },
			}),

			// Orders per day for the last 7 days
			prisma.$queryRaw<{ date: string; orders: bigint; delivered: bigint }[]>`
				SELECT 
					DATE("created_at" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::text AS date,
					COUNT(*) AS orders,
					COUNT(*) FILTER (WHERE status != 'PENDING') AS delivered
				FROM orders
				WHERE "created_at" >= ${startOfWeek}
				GROUP BY DATE("created_at" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')
				ORDER BY date ASC
			`,

			// Order status distribution
			prisma.order.groupBy({
				by: ["status"],
				_count: { id: true },
			}),
		]);

		const totalRevenueValue = totalRevenue._sum.totalAmount ?? 0;
		const lastMonthRevenueValue = lastMonthRevenue._sum.totalAmount ?? 0;

		// Revenue trend: if there was revenue last month, calculate % change v today's month
		const currentMonthRevenue = await prisma.order.aggregate({
			where: {
				status: { in: ["DELIVERED", "COMPLETED"] },
				deliveredAt: { gte: startOfMonth },
				totalAmount: { not: null },
			},
			_sum: { totalAmount: true },
		});
		const currentMonthRevenueValue = currentMonthRevenue._sum.totalAmount ?? 0;
		const revenueTrend =
			lastMonthRevenueValue > 0
				? (
						((currentMonthRevenueValue - lastMonthRevenueValue) /
							lastMonthRevenueValue) *
						100
					).toFixed(1)
				: null;

		return NextResponse.json({
			stats: {
				totalOrders,
				pendingOrders,
				todayOrders,
				totalRevenue: totalRevenueValue,
				currentMonthRevenue: currentMonthRevenueValue,
				lastMonthRevenue: lastMonthRevenueValue,
				revenueTrendPercent: revenueTrend,
				employeeCount,
				pendingCashAdvances: 0,
				monthCashAdvances: 0,
			},
			charts: {
				weekOrders: weekOrdersByDay.map((row) => ({
					date: row.date,
					orders: Number(row.orders),
					delivered: Number(row.delivered),
				})),
				orderStatus: orderStatusCounts.map((s) => ({
					name: s.status,
					value: s._count.id,
				})),
				revenue: await getRevenueTrend(30),
			},
		});
	} catch (error: any) {
		console.error("Admin stats error:", error);
		return NextResponse.json(
			{ error: "Failed to fetch stats" },
			{ status: 500 },
		);
	}
}
