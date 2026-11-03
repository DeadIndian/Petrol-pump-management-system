"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Package, DollarSign, Users, Loader2 } from "lucide-react";

interface StatCardProps {
	title: string;
	value: string;
	trend?: string;
	trendUp?: boolean;
	icon: React.ReactNode;
	loading?: boolean;
}

function StatCard({
	title,
	value,
	trend,
	trendUp,
	icon,
	loading,
}: StatCardProps) {
	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle className="text-sm font-medium">{title}</CardTitle>
				{icon}
			</CardHeader>
			<CardContent>
				{loading ? (
					<Loader2 className="h-6 w-6 animate-spin text-gray-400" />
				) : (
					<div className="text-2xl font-bold">{value}</div>
				)}
				{trend && !loading && (
					<p
						className={`text-xs mt-2 ${trendUp ? "text-green-600" : "text-red-600"}`}>
						{trendUp ? "↑" : "↓"} {trend}
					</p>
				)}
			</CardContent>
		</Card>
	);
}

export interface AdminStats {
	totalOrders: number;
	pendingOrders: number;
	totalRevenue: number;
	revenueTrendPercent: string | null;
	employeeCount: number;
}

export default function DashboardStats({ stats, loading }: { stats: AdminStats | null; loading: boolean }) {
	return (
		<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
			<StatCard
				title="Total Orders"
				value={stats ? stats.totalOrders.toLocaleString() : "—"}
				loading={loading}
				icon={<Package className="h-4 w-4 text-blue-600" />}
			/>
			<StatCard
				title="Pending Orders"
				value={stats ? stats.pendingOrders.toLocaleString() : "—"}
				loading={loading}
				icon={<TrendingUp className="h-4 w-4 text-orange-600" />}
			/>
			<StatCard
				title="Total Order Value"
				value={stats ? `₹${stats.totalRevenue.toLocaleString("en-IN")}` : "—"}
				trend={
					stats?.revenueTrendPercent != null
						? `${stats.revenueTrendPercent}% vs last month`
						: undefined
				}
				trendUp={parseFloat(stats?.revenueTrendPercent ?? "0") >= 0}
				loading={loading}
				icon={<DollarSign className="h-4 w-4 text-green-600" />}
			/>
			<StatCard
				title="Total Employees"
				value={stats ? stats.employeeCount.toLocaleString() : "—"}
				loading={loading}
				icon={<Users className="h-4 w-4 text-purple-600" />}
			/>
		</div>
	);
}
