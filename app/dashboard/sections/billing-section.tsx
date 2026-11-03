"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, RefreshCw, Loader2, Eye } from "lucide-react";
import { api } from "@/lib/api-client";

interface CustomerProfile {
	id: string;
	currentBalance: number;
	totalOrders: number;
	totalPurchases: number;
	totalPayments: number;
}

interface Customer {
	id: string;
	fullName: string;
	email: string;
	phone: string | null;
	customerProfile: CustomerProfile | null;
	_count: {
		orders: number;
	};
}

export default function BillingSection() {
	const router = useRouter();
	const [offset, setOffset] = useState(0);
	const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerTotal, setCustomerTotal] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [searchTerm, setSearchTerm] = useState("");
	const [summary, setSummary] = useState({
		totalCustomers: 0,
		totalOutstanding: 0,
		totalBalance: 0,
	});

  const fetchCustomers = useCallback((signal?: AbortSignal) => {
    const params = new URLSearchParams({ limit: "20", offset: String(offset) });
    if (searchTerm) params.set("search", searchTerm);
    return api.get<{ customers: Customer[]; pagination: { total: number }; summary: { totalCustomers: number; totalOutstanding: number; totalBalance: number } }>(`/api/customers?${params}`, { signal })
      .then(data => { if (!signal?.aborted) { setCustomers(data.customers); setCustomerTotal(data.pagination.total); setSummary(data.summary); setError(null); } })
      .catch(cause => { if (!signal?.aborted) setError(cause.message || "Failed to fetch customers"); })
      .finally(() => { if (!signal?.aborted) setLoading(false); });
  }, [searchTerm, offset]);

	useEffect(() => {
    const controller = new AbortController();
    void fetchCustomers(controller.signal);
    return () => controller.abort();
  }, [fetchCustomers]);

	const getBalanceBadge = (balance: number) => {
		if (balance < 0) {
			return (
				<Badge className="bg-red-100 text-red-800">
					Owes ₹{Math.abs(balance).toLocaleString("en-IN")}
				</Badge>
			);
		}
		if (balance > 0) {
			return (
				<Badge className="bg-green-100 text-green-800">
					Credit ₹{balance.toLocaleString("en-IN")}
				</Badge>
			);
		}
		return <Badge className="bg-gray-100 text-gray-800">Clear</Badge>;
	};

	return (
		<div className="space-y-6">
			{/* Stats */}
			<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
				<Card>
					<CardHeader>
						<CardTitle className="text-sm font-medium">
							Total Customers
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-3xl font-bold">{summary.totalCustomers}</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className="text-sm font-medium">
							Total Outstanding
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-3xl font-bold text-red-600">
							₹{summary.totalOutstanding.toLocaleString("en-IN")}
						</div>
						<p className="text-sm text-gray-500 mt-1">
							Amount due from customers
						</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className="text-sm font-medium">Net Balance</CardTitle>
					</CardHeader>
					<CardContent>
						<div
							className={`text-3xl font-bold ${
								summary.totalBalance < 0 ? "text-red-600" : "text-green-600"
							}`}>
							₹{Math.abs(summary.totalBalance).toLocaleString("en-IN")}
						</div>
						<p className="text-sm text-gray-500 mt-1">
							{summary.totalBalance < 0 ? "Receivable" : "Payable"}
						</p>
					</CardContent>
				</Card>
			</div>

			{/* Customers Table */}
			<Card>
				<CardHeader className="flex flex-wrap flex-row items-center justify-between gap-3">
					<div>
						<CardTitle>Customer Billing</CardTitle>
						<CardDescription>
							Track customer balances and payment history
						</CardDescription>
					</div>
					<Button
						variant="outline"
						size="sm"
						onClick={() => { setLoading(true); void fetchCustomers(); }}
						disabled={loading}>
						<RefreshCw
							className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
						/>
						Refresh
					</Button>
				</CardHeader>
				<CardContent>
					<div className="mb-6 relative">
						<Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
						<Input
							aria-label="Search customers" placeholder="Search by customer name, email, or phone..."
							value={searchTerm}
							onChange={(e) => { setSearchTerm(e.target.value); setOffset(0); setLoading(true); }}
							className="pl-10"
						/>
					</div>

					{error && (
						<div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 mb-4">
							{error}
						</div>
					)}

					{loading ? (
						<div className="flex items-center justify-center py-12">
							<Loader2 className="h-8 w-8 animate-spin text-gray-400" />
						</div>
					) : (
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Customer</TableHead>
										<TableHead>Phone</TableHead>
										<TableHead className="text-right">Total Orders</TableHead>
										<TableHead className="text-right">
											Total Purchases
										</TableHead>
										<TableHead className="text-right">Payments Made</TableHead>
										<TableHead className="text-right">Balance</TableHead>
										<TableHead className="text-right">Action</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{customers.map((customer) => {
										const balance =
											customer.customerProfile?.currentBalance || 0;
										const totalOrders =
											customer.customerProfile?.totalOrders || 0;
										const totalPurchases =
											customer.customerProfile?.totalPurchases || 0;
										const totalPayments =
											customer.customerProfile?.totalPayments || 0;

										return (
											<TableRow
												key={customer.id}
												className="cursor-pointer hover:bg-gray-50"
												onClick={() =>
													router.push(`/dashboard/customers/${customer.id}`)
												}>
												<TableCell>
													<div>
														<p className="font-medium">{customer.fullName}</p>
														<p className="text-xs text-gray-500">
															{customer.email}
														</p>
													</div>
												</TableCell>
												<TableCell className="text-sm">
													{customer.phone || "—"}
												</TableCell>
												<TableCell className="text-right font-medium">
													{totalOrders}
												</TableCell>
												<TableCell className="text-right">
													₹{totalPurchases.toLocaleString("en-IN")}
												</TableCell>
												<TableCell className="text-right">
													₹{totalPayments.toLocaleString("en-IN")}
												</TableCell>
												<TableCell className="text-right">
													{getBalanceBadge(balance)}
												</TableCell>
												<TableCell className="text-right">
													<Button
														variant="outline"
														size="sm"
														onClick={(e) => {
															e.stopPropagation();
															router.push(
																`/dashboard/customers/${customer.id}`,
															);
														}}>
														<Eye className="h-4 w-4 mr-1" />
														View
													</Button>
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
							{customers.length === 0 && (
								<div className="text-center py-8 text-gray-500">
									No customers found
								</div>
							)}
						</div>
					)}
                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-600">Showing {customerTotal ? offset + 1 : 0}–{Math.min(offset + customers.length, customerTotal)} of {customerTotal}</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!offset || loading} onClick={() => { setLoading(true); setOffset(Math.max(0, offset - 20)); }}>Previous customers</Button><Button variant="outline" disabled={offset + 20 >= customerTotal || loading} onClick={() => { setLoading(true); setOffset(offset + 20); }}>Next customers</Button></div></div>
				</CardContent>
			</Card>
		</div>
	);
}
