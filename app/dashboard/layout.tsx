import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect((await cookies()).get("refresh_token") ? "/api/auth/refresh" : "/login");
  return <>{children}</>;
}
