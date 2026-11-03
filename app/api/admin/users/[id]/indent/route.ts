import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requireRole, successResponse, errorResponse } from "@/lib/auth";
import { SetIndentSchema } from "@/lib/validation";

/**
 * POST /api/admin/users/[id]/indent
 * Update a customer's indent settings
 */
export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
    const routeParams = await params;
	try {
		const authResult = await authenticate(request);
		if (authResult instanceof Response) return authResult;

		const authRequest = authResult as any;
		const roleCheck = requireRole("ADMIN")(authRequest);
		if (roleCheck) return roleCheck;

		const userId = routeParams.id;
		const body = await request.json();
		const validatedData = SetIndentSchema.parse(body);

    await prisma.$transaction(async tx => {
      const user = await tx.user.findUnique({ where: { id: userId }, include: { customerProfile: true } });
      if (!user) throw new Error("USER_NOT_FOUND");
      if (user.role !== "CUSTOMER") throw new Error("NOT_CUSTOMER");
      if (!user.customerProfile) await tx.customerProfile.create({ data: { userId } });
      // Share the allocation lock so an in-flight order cannot reuse a reset indent.
      await tx.$queryRaw`SELECT id FROM customer_profiles WHERE user_id = ${userId} FOR UPDATE`;
      const used = await tx.order.count({ where: { customerId: userId, indentNumber: {
        gte: validatedData.indentStart, lte: validatedData.indentEnd,
      } } });
      if (used) throw new Error("USED_RANGE");
      await tx.customerProfile.update({ where: { userId }, data: {
        indentStart: validatedData.indentStart, indentEnd: validatedData.indentEnd,
        currentIndent: validatedData.indentStart,
      } });
      await tx.auditLog.create({ data: { userId: authRequest.user.id, action: "INDENT_CONFIGURED",
        tableName: "customer_profiles", recordId: userId, changes: JSON.stringify(validatedData) } });
    }, { maxWait: 15000, timeout: 15000 });

		return successResponse({ message: "Indent configuration updated successfully" });
	} catch (error: any) {
    if (error.message === "USER_NOT_FOUND") return errorResponse("User not found", 404);
    if (error.message === "NOT_CUSTOMER") return errorResponse("Indents can only be assigned to customers", 400);
    if (error.message === "USED_RANGE" || error.code === "P2002") return errorResponse("This range includes previously used indents. Choose a new, unused range.", 409);
    if (error instanceof SyntaxError) return errorResponse("Invalid JSON", 400);
		console.error("Update indent error:", error);
		if (error.name === "ZodError") {
			return errorResponse("Validation error", 400, error.issues);
		}
		return errorResponse("Failed to update indent setting", 500);
	}
}
