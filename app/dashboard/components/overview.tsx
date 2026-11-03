"use client";
import { useCallback, useEffect, useState } from "react";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { api } from "@/lib/api-client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import DashboardStats, { type AdminStats } from "./dashboard-stats";
interface OverviewData { stats: AdminStats; charts: { weekOrders: { date: string; orders: number; delivered: number }[]; orderStatus: { name: string; value: number }[]; revenue: { date: string; revenue: number }[] }; }
export default function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback((signal?: AbortSignal) => api.get<OverviewData>("/api/admin/stats", { signal })
    .then(result => { if (!signal?.aborted) { setData(result); setError(""); } })
    .catch(cause => { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Could not load overview"); })
    .finally(() => { if (!signal?.aborted) setLoading(false); }), []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = setInterval(() => void load(controller.signal), 30000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [load]);
  return <section className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Operations overview</h2><Button variant="outline" onClick={() => void load()}>Refresh overview</Button></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    <DashboardStats stats={data?.stats || null} loading={loading} />
    <div className="grid min-w-0 gap-5 lg:grid-cols-2"><Card className="min-w-0"><CardHeader><CardTitle>Orders in the last 7 days</CardTitle></CardHeader><CardContent>
      {data?.charts.weekOrders.length ? <div role="img" aria-label="Actual daily order and delivery counts" className="h-64 min-w-0"><ResponsiveContainer width="100%" height="100%"><LineChart data={data.charts.weekOrders}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={value => String(value).slice(5)} /><YAxis allowDecimals={false} width={35} /><Tooltip /><Legend /><Line isAnimationActive={false} type="monotone" dataKey="orders" name="Orders" stroke="#2563eb" /><Line isAnimationActive={false} type="monotone" dataKey="delivered" name="Completed" stroke="#15803d" /></LineChart></ResponsiveContainer></div> : <p className="py-8 text-slate-600">No orders in this period.</p>}
    </CardContent></Card><Card className="min-w-0"><CardHeader><CardTitle>Order status</CardTitle></CardHeader><CardContent>
      {data?.charts.orderStatus.length ? <div role="img" aria-label="Actual order status distribution" className="h-64 min-w-0"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie isAnimationActive={false} data={data.charts.orderStatus} dataKey="value" nameKey="name" outerRadius={80}>{data.charts.orderStatus.map((row, index) => <Cell key={row.name} fill={["#2563eb", "#15803d", "#b45309"][index % 3]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></div> : <p className="py-8 text-slate-600">No orders yet.</p>}
    </CardContent></Card></div>
    <Card className="min-w-0"><CardHeader><CardTitle>Completed order value in the last 30 days</CardTitle></CardHeader><CardContent>
      {data?.charts.revenue.length ? <div role="img" aria-label="Actual completed order value by day" className="h-64 min-w-0"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.charts.revenue}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={value => String(value).slice(5)} /><YAxis width={55} /><Tooltip /><Bar isAnimationActive={false} dataKey="revenue" name="Order value (₹)" fill="#2563eb" /></BarChart></ResponsiveContainer></div> : <p className="py-8 text-slate-600">No completed orders in this period.</p>}
    </CardContent></Card>
  </section>;
}
