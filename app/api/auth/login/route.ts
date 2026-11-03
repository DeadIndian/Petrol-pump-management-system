import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { LoginSchema } from "@/lib/validation";
import { successResponse, errorResponse } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase";
import { setSessionCookies } from "@/lib/session";

/**
 * POST /api/auth/login
 * Login user and return session
 */
export async function POST(request: NextRequest) {
	try {
		const body = await request.json();
		const validatedData = LoginSchema.parse(body);

		// Authenticate with Supabase
		const { data, error } = await createSupabaseServerClient().auth.signInWithPassword({
			email: validatedData.email,
			password: validatedData.password,
		});

		if (error || !data.session) {
			return errorResponse("Invalid email or password", 401);
		}

		// Get user profile from database
		const userProfile = await prisma.user.findUnique({
			where: { id: data.user.id },
			select: {
				id: true,
				email: true,
				fullName: true,
				role: true,
				phone: true,
			},
		});

		if (!userProfile) {
			return errorResponse("User profile not found", 404);
		}

		return setSessionCookies(successResponse({
			message: "Login successful",
			session: {
				accessToken: data.session.access_token,
				refreshToken: data.session.refresh_token,
				expiresIn: data.session.expires_in,
			},
			user: {
				id: userProfile.id,
				email: userProfile.email,
				fullName: userProfile.fullName,
				role: userProfile.role,
				phone: userProfile.phone,
			},
		}), request, data.session);
	} catch (error: any) {
		console.error("Login error:", error);
		if (error.name === "ZodError") {
			return errorResponse("Validation error", 400, error.errors);
		}
		return errorResponse("Internal server error", 500);
	}
}
