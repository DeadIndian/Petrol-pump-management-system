import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requireRole, successResponse, errorResponse } from "@/lib/auth";
import { CreateOrderSchema, OrderFilterSchema } from "@/lib/validation";

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticate(request);
    if (auth instanceof NextResponse) return auth;
    const roleError = requireRole("CUSTOMER", "ADMIN")(auth);
    if (roleError) return roleError;
    const input = CreateOrderSchema.parse(await request.json());
    if (auth.user!.role === "CUSTOMER" && input.customerId && input.customerId !== auth.user!.id) {
      return errorResponse("You can only place orders for your own account", 403);
    }
    const customerId = auth.user!.role === "ADMIN" ? input.customerId : auth.user!.id;
    if (!customerId) return errorResponse("Choose a customer", 400);
    const customer = await prisma.user.findUnique({ where: { id: customerId } });
    if (!customer || customer.role !== "CUSTOMER") return errorResponse("Customer not found", 404);
    const order = await prisma.$transaction(async (tx) => {
      // A row lock serializes allocation. Two requests cannot consume the same indent.
      const profiles = await tx.$queryRaw<{ id: string; current_indent: number | null; indent_end: number | null }[]>`
        SELECT id, current_indent, indent_end FROM customer_profiles WHERE user_id = ${customerId} FOR UPDATE
      `;
      const profile = profiles[0];
      const account = await tx.user.findUnique({ where: { id: customerId }, select: { role: true } });
      if (!account || account.role !== "CUSTOMER") throw new Error("CUSTOMER_NOT_FOUND");
      if (!profile || profile.current_indent == null || profile.indent_end == null) throw new Error("INDENT_NOT_CONFIGURED");
      if (profile.current_indent > profile.indent_end) throw new Error("INDENT_EXHAUSTED");
      await tx.customerProfile.update({ where: { id: profile.id }, data: { currentIndent: { increment: 1 } } });
      const result = await tx.order.create({
        data: { customerId, vehicleNumber: input.vehicleNumber.trim().toUpperCase(),
          indentNumber: profile.current_indent, fuelType: input.fuelType,
          amountRequested: input.amountRequested, quantityRequested: input.quantityRequested, cash: input.cash },
        include: { customer: { select: { id: true, fullName: true, email: true, phone: true } } },
      });
      await tx.auditLog.create({ data: { userId: auth.user!.id, action: "ORDER_CREATED", tableName: "orders", recordId: result.id,
        changes: JSON.stringify({ customerId, indentNumber: result.indentNumber }) } });
      return result;
    }, { maxWait: 15000, timeout: 15000 });
    return successResponse({ message: "Order placed successfully", order }, 201);
  } catch (error: any) {
    if (error.message === "CUSTOMER_NOT_FOUND") return errorResponse("Customer not found", 404);
    if (error.message === "INDENT_NOT_CONFIGURED") return errorResponse("Ask an administrator to configure your indent range before ordering.", 400);
    if (error.message === "INDENT_EXHAUSTED") return errorResponse("Your indent range is exhausted. Ask an administrator for a new range.", 409);
    if (error.name === "ZodError") return errorResponse("Validation error", 400, error.errors);
    if (error instanceof SyntaxError) return errorResponse("Invalid JSON", 400);
    console.error("Order creation failed:", error);
    return errorResponse("Could not place order", 500);
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticate(request);
    if (auth instanceof NextResponse) return auth;
    const params = request.nextUrl.searchParams;
    const filter = OrderFilterSchema.parse({
      status: params.get("status") || undefined, fuelType: params.get("fuelType") || undefined,
      customerId: params.get("customerId") || undefined,
      limit: Number(params.get("limit") || 20), offset: Number(params.get("offset") || 0),
    });
    if (auth.user!.role === "CUSTOMER" && filter.customerId && filter.customerId !== auth.user!.id) return errorResponse("Unauthorized", 403);
    const where: Prisma.OrderWhereInput = {
      ...(auth.user!.role === "CUSTOMER" ? { customerId: auth.user!.id } : filter.customerId ? { customerId: filter.customerId } : {}),
      ...(filter.status && { status: filter.status }), ...(filter.fuelType && { fuelType: filter.fuelType }),
    };
    if (params.get("fulfilledBy") === "me") where.fulfilledById = auth.user!.id;
    const search = params.get("search")?.trim();
    if (search) where.OR = [
      { id: { contains: search, mode: "insensitive" } }, { vehicleNumber: { contains: search, mode: "insensitive" } },
      { customer: { fullName: { contains: search, mode: "insensitive" } } },
      ...(/^\d+$/.test(search) ? [{ indentNumber: Number(search) }] : []),
    ];
    const [orders, total] = await Promise.all([
      prisma.order.findMany({ where, include: { customer: { select: { id: true, fullName: true, email: true, phone: true } },
        fulfilledBy: { select: { fullName: true } } }, orderBy: { createdAt: "desc" }, take: filter.limit, skip: filter.offset }),
      prisma.order.count({ where }),
    ]);
    return successResponse({ orders, pagination: { total, limit: filter.limit, offset: filter.offset } });
  } catch (error: any) {
    if (error.name === "ZodError") return errorResponse("Invalid order filters", 400, error.errors);
    console.error("Order list failed:", error);
    return errorResponse("Could not load orders", 500);
  }
}
