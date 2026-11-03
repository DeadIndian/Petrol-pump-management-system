import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requireRole, successResponse, errorResponse } from "@/lib/auth";
import { MarkOrderDeliveredSchema } from "@/lib/validation";
import { getFuelPrice } from "@/lib/db-utils";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
    const routeParams = await params;
  const auth = await authenticate(request);
  if (auth instanceof NextResponse) return auth;
  const order = await prisma.order.findUnique({ where: { id: routeParams.id },
    include: { customer: { select: { id: true, fullName: true, email: true, phone: true } }, fulfilledBy: { select: { fullName: true } } } });
  if (!order) return errorResponse("Order not found", 404);
  if (auth.user!.role === "CUSTOMER" && order.customerId !== auth.user!.id) return errorResponse("Unauthorized", 403);
  return successResponse({ order });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const routeParams = await params;
  try {
    const auth = await authenticate(request);
    if (auth instanceof NextResponse) return auth;
    const roleError = requireRole("EMPLOYEE", "ADMIN")(auth);
    if (roleError) return roleError;
    const input = MarkOrderDeliveredSchema.parse(await request.json());
    const order = await prisma.order.findUnique({ where: { id: routeParams.id } });
    if (!order) return errorResponse("Order not found", 404);
    if (order.status !== "PENDING") return errorResponse("This order has already been completed", 409);
    const price = await getFuelPrice(order.fuelType);
    if (!price) return errorResponse("Set a fuel price before completing delivery", 400);
    const totalAmount = Number((input.quantityDelivered * price + order.cash).toFixed(2));
    const completed = await prisma.$transaction(async (tx) => {
      // The pending status is part of the write, so a concurrent delivery can only win once.
      const claim = await tx.order.updateMany({ where: { id: routeParams.id, status: "PENDING" }, data: {
        status: "COMPLETED", quantityDelivered: input.quantityDelivered, pricePerLiter: price, totalAmount,
        deliveredAt: new Date(), completedAt: new Date(), fulfilledById: auth.user!.id,
      } });
      if (claim.count !== 1) throw new Error("ALREADY_COMPLETED");
      await tx.customerProfile.update({ where: { userId: order.customerId }, data: {
        currentBalance: { decrement: totalAmount }, totalOrders: { increment: 1 }, totalPurchases: { increment: totalAmount },
      } });
      await tx.auditLog.create({ data: { userId: auth.user!.id, action: "ORDER_COMPLETED", tableName: "orders", recordId: routeParams.id,
        changes: JSON.stringify({ quantityDelivered: input.quantityDelivered, pricePerLiter: price, cash: order.cash, totalAmount }) } });
      return tx.order.findUnique({ where: { id: routeParams.id }, include: { customer: { select: { id: true, fullName: true, email: true } } } });
    }, { maxWait: 15000, timeout: 15000 });
    return successResponse({ message: "Delivery completed and customer balance updated", order: completed });
  } catch (error: any) {
    if (error.message === "ALREADY_COMPLETED") return errorResponse("This order has already been completed", 409);
    if (error.name === "ZodError") return errorResponse("Enter a valid delivered quantity", 400, error.issues);
    if (error instanceof SyntaxError) return errorResponse("Invalid JSON", 400);
    console.error("Delivery failed:", error);
    return errorResponse("Could not complete delivery", 500);
  }
}
