import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";

export default async function CustomerAccountsLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (user && user.role !== "ADMIN") redirect("/dashboard");
  return <>{children}</>;
}
