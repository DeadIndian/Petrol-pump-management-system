import { NextRequest } from "next/server";
import { SignupSchema } from "@/lib/validation";
import { successResponse, errorResponse } from "@/lib/auth";
import { createManagedUser } from "@/lib/user-utils";

export async function POST(request: NextRequest) {
  try {
    const input = SignupSchema.parse(await request.json());
    const user = await createManagedUser(input);
    return successResponse({ message: "Account created. You can now sign in.", user: {
      id: user.id, email: user.email, fullName: user.fullName, role: user.role,
    } }, 201);
  } catch (error: any) {
    if (error.name === "ZodError") return errorResponse("Validation error", 400, error.errors);
    if (error instanceof SyntaxError) return errorResponse("Invalid JSON", 400);
    return errorResponse(error.message || "Could not create account", 400);
  }
}
