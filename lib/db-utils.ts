import { prisma } from "./prisma";
import { FuelType, OrderStatus } from "@prisma/client";
import { businessDate } from "./dates";

/**
 * Get the fuel price for a specific fuel type on a specific date
 * Falls back to the most recent available price if the date has no price
 */
export async function getFuelPrice(
	fuelType: FuelType,
	date: Date = new Date(),
): Promise<number | null> {
	const targetDate = businessDate(date);

	// Try to get price for the exact date
	const price = await prisma.fuelPrice.findFirst({
		where: {
			fuelType,
			date: {
				lte: targetDate,
			},
		},
		orderBy: {
			date: "desc",
		},
	});

	if (!price) {
		// No price available - this shouldn't happen if system is properly maintained
		console.warn(
			`No fuel price found for ${fuelType} on or before ${targetDate}`,
		);
		return null;
	}

	return price.pricePerLiter;
}

/**
 * Get the latest prices for all fuel types
 */
export async function getLatestPrices() {
	const latestPrices = await prisma.fuelPrice.groupBy({
		by: ["fuelType"],
        where: { date: { lte: businessDate() } },
		_max: {
			date: true,
		},
	});

	const prices = await Promise.all(
		latestPrices.map(async (group) => {
			if (!group._max.date) return null;
			const price = await prisma.fuelPrice.findFirst({
				where: {
					fuelType: group.fuelType,
					date: group._max.date,
				},
			});
			return price;
		}),
	);

	return prices.filter((p) => p !== null);
}

/**
 * Calculate the quantity delivered for an amount-based order
 */
export async function calculateQuantityForAmount(
	amount: number,
	fuelType: FuelType,
	deliveryDate?: Date,
): Promise<number> {
	const pricePerLiter = await getFuelPrice(fuelType, deliveryDate);
	if (!pricePerLiter) {
		throw new Error(`No fuel price available for ${fuelType}`);
	}
	return amount / pricePerLiter;
}

/**
 * Calculate the amount for a quantity-based order
 */
export async function calculateAmountForQuantity(
	quantity: number,
	fuelType: FuelType,
	deliveryDate?: Date,
): Promise<number> {
	const pricePerLiter = await getFuelPrice(fuelType, deliveryDate);
	if (!pricePerLiter) {
		throw new Error(`No fuel price available for ${fuelType}`);
	}
	return quantity * pricePerLiter;
}

/**
 * Create an audit log for admin actions
 */
export async function createAuditLog(
	userId: string,
	action: string,
	tableName: string,
	recordId?: string,
	changes?: Record<string, unknown>,
) {
	return prisma.auditLog.create({
		data: {
			userId,
			action,
			tableName,
			recordId,
			changes: JSON.stringify(changes || {}),
		},
	});
}

/**
 * Get pending orders for an employee
 */
export async function getPendingOrders() {
	return prisma.order.findMany({
		where: {
			status: OrderStatus.PENDING,
		},
		include: {
			customer: {
				select: {
					id: true,
					fullName: true,
					phone: true,
					email: true,
				},
			},
		},
		orderBy: {
			createdAt: "asc",
		},
	});
}

/**
 * Get customer's orders
 */
export async function getCustomerOrders(customerId: string) {
	return prisma.order.findMany({
		where: {
			customerId,
		},
		include: {},
		orderBy: {
			createdAt: "desc",
		},
	});
}

/**
 * Get all orders with optional filtering (for admin dashboard)
 */
export async function getAllOrders(
	filters: {
		status?: OrderStatus;
		fuelType?: FuelType;
		customerId?: string;
		limit?: number;
		offset?: number;
	} = {},
) {
	const { status, fuelType, customerId, limit = 20, offset = 0 } = filters;

	const where: any = {};
	if (status) where.status = status;
	if (fuelType) where.fuelType = fuelType;
	if (customerId) where.customerId = customerId;

	const [orders, total] = await Promise.all([
		prisma.order.findMany({
			where,
			include: {
				customer: {
					select: {
						id: true,
						fullName: true,
						phone: true,
						email: true,
					},
				},
			},
			orderBy: {
				createdAt: "desc",
			},
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
		pages: Math.ceil(total / limit),
	};
}

/**
 * Update order status with audit logging
 */
export async function updateOrderStatus(
	orderId: string,
	newStatus: OrderStatus,
	adminId: string,
	additionalData?: { deliveredAt?: Date },
) {
	const order = await prisma.order.findUnique({
		where: { id: orderId },
	});

	if (!order) {
		throw new Error("Order not found");
	}

	const updated = await prisma.order.update({
		where: { id: orderId },
		data: {
			status: newStatus,
			...additionalData,
		},
	});

	// Create audit log
	await createAuditLog(adminId, "ORDER_STATUS_UPDATE", "orders", orderId, {
		from: order.status,
		to: newStatus,
		timestamp: new Date().toISOString(),
	});

	return updated;
}

/**
 * Set daily fuel price
 * Ensures only one price per fuel type per day
 * Returns error if price already set for the day
 */
export async function setDailyPrice(
	fuelType: FuelType,
	pricePerLiter: number,
	adminId: string,
	date: Date = new Date(),
) {
	// Set date to start of day (ignore time)
	const targetDate = businessDate(date);

	if (targetDate.getTime() !== businessDate().getTime()) throw new Error("Prices can only be set for today");

	// Check if price already exists for today
	const existingPrice = await prisma.fuelPrice.findFirst({
		where: {
			fuelType,
			date: {
				gte: targetDate,
				lt: new Date(targetDate.getTime() + 24 * 60 * 60 * 1000),
			},
		},
	});

	if (existingPrice) {
		throw new Error(
			`Price for ${fuelType} already set today. Cannot set multiple prices in a 24-hour period.`,
		);
	}

	// Create new price entry
	const newPrice = await prisma.fuelPrice.create({
		data: {
			fuelType,
			pricePerLiter,
			date: targetDate,
			createdByAdminId: adminId,
		},
	});

	// Log audit
	await createAuditLog(adminId, "PRICE_SET", "fuel_prices", newPrice.id, {
		fuelType,
		pricePerLiter,
		date: targetDate.toISOString(),
	});

	return newPrice;
}

/**
 * Update daily fuel price
 * Only admin can update within the same day (before 24 hours pass)
 */
export async function updateDailyPrice(
	priceId: string,
	newPricePerLiter: number,
	adminId: string,
) {
	const price = await prisma.fuelPrice.findUnique({
		where: { id: priceId },
	});

	if (!price) {
		throw new Error("Price record not found");
	}

	// Check if we're still within the same day
	const now = new Date();
	const priceDate = new Date(price.date);
	const dayAfter = new Date(priceDate.getTime() + 24 * 60 * 60 * 1000);

	if (businessDate(now).getTime() !== priceDate.getTime() || now > dayAfter) {
		throw new Error(
			"Cannot update price. 24-hour period has passed. Use setDailyPrice for a new day.",
		);
	}

	const oldPrice = price.pricePerLiter;

	const updated = await prisma.fuelPrice.update({
		where: { id: priceId },
		data: {
			pricePerLiter: newPricePerLiter,
		},
	});

	// Log audit
	await createAuditLog(adminId, "PRICE_UPDATE", "fuel_prices", priceId, {
		fuelType: price.fuelType,
		oldPrice,
		newPrice: newPricePerLiter,
		date: price.date.toISOString(),
	});

	return updated;
}

/**
 * Get price history for a fuel type
 * Shows how price has changed over time
 */
export async function getPriceHistory(fuelType: FuelType, days: number = 30) {
	const startDate = new Date();
	startDate.setDate(startDate.getDate() - days);

	const history = await prisma.fuelPrice.findMany({
		where: {
			fuelType,
			date: {
				gte: startDate,
			},
		},
		orderBy: {
			date: "desc",
		},
	});

	return history;
}

/**
 * Check if price needs to be updated (last update was > 24 hours ago)
 */
export async function shouldUpdatePrice(fuelType: FuelType): Promise<boolean> {
	const lastPrice = await prisma.fuelPrice.findFirst({
		where: { fuelType, date: { lte: businessDate() } },
		orderBy: {
			date: "desc",
		},
	});

	if (!lastPrice) {
		return true; // No price exists
	}

	const now = new Date();
	const lastPriceDate = new Date(lastPrice.date);
	const hoursSinceUpdate =
		(now.getTime() - lastPriceDate.getTime()) / (1000 * 60 * 60);

	return hoursSinceUpdate >= 24;
}

/**
 * Get all fuel types that need price updates
 * Returns fuel types where last update was > 24 hours ago
 */
export async function getFuelTypesThatNeedPriceUpdate(): Promise<FuelType[]> {
	const fuelTypes: FuelType[] = ["PETROL", "DIESEL"];
	const needsUpdate: FuelType[] = [];

	for (const fuelType of fuelTypes) {
		const needsUpdateFlag = await shouldUpdatePrice(fuelType);
		if (needsUpdateFlag) {
			needsUpdate.push(fuelType);
		}
	}

	return needsUpdate;
}

/**
 * Get price update status for dashboard
 * Shows status of each fuel type and when last updated
 */
export async function getPriceUpdateStatus() {
	const fuelTypes: FuelType[] = ["PETROL", "DIESEL"];

	const status = await Promise.all(
		fuelTypes.map(async (fuelType) => {
			const lastPrice = await prisma.fuelPrice.findFirst({
				where: { fuelType, date: { lte: businessDate() } },
				orderBy: {
					date: "desc",
				},
			});

			if (!lastPrice) {
				return {
					fuelType,
					currentPrice: null,
                    priceId: null,
					lastUpdated: null,
					needsUpdate: true,
					hoursOverdue: null,
				};
			}

			const now = new Date();
			const lastUpdateDate = new Date(lastPrice.date);
			const hoursSinceUpdate =
				(now.getTime() - lastUpdateDate.getTime()) / (1000 * 60 * 60);
			const needsUpdate = lastUpdateDate.getTime() < businessDate().getTime();
			const hoursOverdue = needsUpdate ? Math.round(hoursSinceUpdate - 24) : 0;

			return {
				fuelType,
				currentPrice: lastPrice.pricePerLiter,
                priceId: lastPrice.id,
				lastUpdated: lastPrice.updatedAt,
				needsUpdate,
				hoursOverdue,
			};
		}),
	);

	return status;
}
