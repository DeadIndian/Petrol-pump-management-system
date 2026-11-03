import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, errorResponse } from "@/lib/auth";
import { createManagedUser } from "@/lib/user-utils";
import { z } from "zod";

const CreateUserSchema = z.object({ email: z.string().email(), password: z.string().min(8),
  fullName: z.string().min(2), phone: z.string().optional(), role: z.enum(["CUSTOMER", "EMPLOYEE", "ADMIN"]).default("CUSTOMER") });
const ListSchema = z.object({ role: z.enum(["CUSTOMER", "EMPLOYEE", "ADMIN"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) });

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticate(request);
    if (auth instanceof NextResponse) return auth;
    if (auth.user!.role !== "ADMIN") return errorResponse("Admin access required", 403);
    const params = request.nextUrl.searchParams;
    const input = ListSchema.parse({ role: params.get("role") || undefined,
      limit: params.get("limit") || undefined, offset: params.get("offset") || undefined });
    const search = params.get("search") || "";
    const where: any = { ...(input.role && { role: input.role }), ...(search && { OR: [
      { fullName: { contains: search, mode: "insensitive" } }, { email: { contains: search, mode: "insensitive" } },
    ] }) };
    const [users, total, deliveries, counts] = await Promise.all([
      prisma.user.findMany({ where, select: { id: true, email: true, fullName: true, phone: true, role: true,
        createdAt: true, updatedAt: true, _count: { select: { orders: true, fulfilledOrders: true } } },
        orderBy: { createdAt: "desc" }, take: input.limit, skip: input.offset }),
      prisma.user.count({ where }),
      prisma.order.groupBy({ by: ["fulfilledById"], where: { fulfilledById: { not: null }, status: "COMPLETED" },
        _sum: { quantityDelivered: true, totalAmount: true }, _max: { completedAt: true }, _count: { id: true } }),
      prisma.user.groupBy({ by: ["role"], _count: { id: true } }),
    ]);
    const activity = new Map(deliveries.map(row => [row.fulfilledById, {
      completedOrders: row._count.id, deliveredLiters: row._sum.quantityDelivered || 0,
      totalValue: row._sum.totalAmount || 0, lastDeliveryAt: row._max.completedAt,
    }]));
    const summary = { ADMIN: 0, EMPLOYEE: 0, CUSTOMER: 0 };
    counts.forEach(row => { summary[row.role] = row._count.id; });
    return NextResponse.json({ summary, users: users.map(user => ({ ...user, activity: activity.get(user.id) || {
      completedOrders: 0, deliveredLiters: 0, totalValue: 0, lastDeliveryAt: null,
    } })), pagination: { total, limit: input.limit, offset: input.offset } });
  } catch (error: any) {
    if (error.name === "ZodError") return errorResponse("Invalid user filters", 400, error.errors);
    console.error("User list failed:", error);
    return errorResponse("Could not load users", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticate(request);
    if (auth instanceof NextResponse) return auth;
    if (auth.user!.role !== "ADMIN") return errorResponse("Admin access required", 403);
    const user = await createManagedUser(CreateUserSchema.parse(await request.json()));
    return NextResponse.json({ message: "User created successfully", user }, { status: 201 });
  } catch (error: any) {
    if (error.name === "ZodError") return errorResponse("Validation error", 400, error.errors);
    if (error instanceof SyntaxError) return errorResponse("Invalid JSON", 400);
    return errorResponse(error.message || "Could not create user", 400);
  }
}
