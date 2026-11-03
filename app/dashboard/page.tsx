import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import DashboardClient from "./dashboard-client";

export const metadata = { title: "Dashboard | Petrol Pump Management" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await getSessionUser();
  // Next can reuse the layout during navigation, so the page also checks
  // expired sessions instead of returning a blank dashboard.
  if (!user) redirect((await cookies()).get("refresh_token") ? "/api/auth/refresh" : "/login");
  return <DashboardClient user={user} initialTab={(await searchParams).tab} />;
}
