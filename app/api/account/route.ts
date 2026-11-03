import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, successResponse, errorResponse } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof NextResponse) return auth;
  const user = await prisma.user.findUnique({ where: { id: auth.user!.id }, select: {
    id: true, fullName: true, email: true, phone: true, role: true, customerProfile: true,
  } });
  if (!user) return errorResponse("Account not found", 404);
  const deliveries = await prisma.order.aggregate({ where: { fulfilledById: user.id, status: "COMPLETED" },
    _count: { id: true }, _sum: { quantityDelivered: true, totalAmount: true } });
  return successResponse({ user, activity: { completedOrders: deliveries._count.id,
    deliveredLiters: deliveries._sum.quantityDelivered || 0, totalValue: deliveries._sum.totalAmount || 0 } });
}
