"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { WebUser } from "@/lib/web-types";
import { api } from "@/lib/api-client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import OrdersSection from "./sections/orders-section";
import PriceManagementSection from "./sections/price-management-section";
import BillingSection from "./sections/billing-section";
import EmployeeActivitySection from "./sections/employee-activity-section";
import UsersSection from "./sections/users-section";
import AccountSection from "./sections/account-section";
import FuelPricesSection from "./sections/fuel-prices-section";
import Overview from "./components/overview";

export default function DashboardClient({ user, initialTab }: { user: WebUser; initialTab?: string }) {
  const router = useRouter();
  const isAdmin = user.role === "ADMIN";
  const navigation = isAdmin ? [["overview", "Overview"], ["orders", "Orders"], ["prices", "Prices"], ["billing", "Billing"], ["employees", "Employees"], ["users", "Users"]] : [["orders", "Orders"], ["prices", "Prices"], ["account", "My account"]];
  const [activeTab, setActiveTab] = useState(navigation.some(([value]) => value === initialTab) ? initialTab! : navigation[0][0]);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setSigningOut(true); setError("");
    try { await api.post("/api/auth/logout"); router.push("/login"); router.refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not sign out"); }
    finally { setSigningOut(false); }
  }
  return <main className="min-h-dvh bg-slate-50 px-4 py-5 sm:p-8" style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}>
    <div className="mx-auto min-w-0 max-w-7xl"><header className="mb-6 flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><h1 className="text-2xl font-semibold sm:text-3xl">{isAdmin ? "Admin Dashboard" : user.role === "EMPLOYEE" ? "Delivery Dashboard" : "Customer Dashboard"}</h1><p className="mt-2 break-words text-slate-600">{user.fullName} · Petrol Pump Management</p></div><Button variant="outline" disabled={signingOut} onClick={() => void logout()}>{signingOut ? "Signing out…" : "Sign out"}</Button></header>
      {error && <p role="alert" className="mb-5 rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
      <Tabs value={activeTab} onValueChange={value => {
        setActiveTab(value);
        // Tabs load their own data. Keep the URL without racing a server
        // navigation against the shared browser session refresh.
        window.history.replaceState(null, "", `/dashboard?tab=${value}`);
      }} className="min-w-0">
        <div className="mb-6 overflow-x-auto"><TabsList aria-label="Dashboard sections" className="h-auto min-w-full justify-start gap-1 bg-white p-1">{navigation.map(([value, label]) => <TabsTrigger key={value} value={value} className="min-h-11 shrink-0 px-4">{label}</TabsTrigger>)}</TabsList></div>
        {isAdmin && <TabsContent value="overview"><Overview /></TabsContent>}
        <TabsContent value="orders"><OrdersSection user={user} /></TabsContent>
        <TabsContent value="prices">{isAdmin ? <PriceManagementSection /> : <FuelPricesSection />}</TabsContent>
        {isAdmin ? <><TabsContent value="billing"><BillingSection /></TabsContent><TabsContent value="employees"><EmployeeActivitySection /></TabsContent><TabsContent value="users"><UsersSection /></TabsContent></> : <TabsContent value="account"><AccountSection /></TabsContent>}
      </Tabs>
    </div>
  </main>;
}
