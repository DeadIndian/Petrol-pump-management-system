import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase";

export async function createManagedUser(input: {
  email: string; password: string; fullName: string; phone?: string; role: Role;
}) {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.admin.createUser({
    email: input.email, password: input.password, email_confirm: true,
  });
  if (error || !data.user) throw new Error(error?.message || "Could not create account");
  try {
    return await prisma.user.create({
      data: {
        id: data.user.id, email: input.email, fullName: input.fullName,
        phone: input.phone || null, role: input.role,
        ...(input.role === "CUSTOMER" && { customerProfile: { create: {} } }),
      },
    });
  } catch (cause) {
    await supabase.auth.admin.deleteUser(data.user.id);
    throw cause;
  }
}
