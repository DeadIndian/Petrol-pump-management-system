"use client";

import { useState, useEffect, useCallback } from "react";
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
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Search, RefreshCw, Loader2 } from "lucide-react";
import { api } from "@/lib/api-client";

type TransactionType = "DISBURSED" | "RECONCILED" | "REFUNDED";

interface CashAdvanceTx {
	id: string;
	orderId: string;
	amount: number;
	transactionType: TransactionType;
	description: string | null;
	reconciliationBillId: string | null;
	createdAt: string;
	employee: {
		id: string;
		fullName: string;
		email: string;
	};
}

const TYPE_COLORS: Record<TransactionType, string> = {
	DISBURSED: "bg-blue-100 text-blue-800",
	RECONCILED: "bg-green-100 text-green-800",
	REFUNDED: "bg-gray-100 text-gray-800",
};

export default function CashAdvancesSection() {
	const [transactions, setTransactions] = useState<CashAdvanceTx[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [searchTerm, setSearchTerm] = useState("");

  const fetchTransactions = useCallback((signal?: AbortSignal) => api.get<{ transactions: CashAdvanceTx[] }>("/api/cash-advances", { signal })
    .then(data => { if (!signal?.aborted) { setTransactions(data.transactions); setError(null); } })
    .catch(cause => { if (!signal?.aborted) setError(cause.message || "Failed to fetch cash advances"); })
    .finally(() => { if (!signal?.aborted) setLoading(false); }), []);

	useEffect(() => {
    const controller = new AbortController();
    void fetchTransactions(controller.signal);
    return () => controller.abort();
  }, [fetchTransactions]);

	const filteredTransactions = transactions.filter((tx) => {
		if (!searchTerm) return true;
		const q = searchTerm.toLowerCase();
		return (
			tx.employee.fullName.toLowerCase().includes(q) ||
			tx.id.toLowerCase().includes(q) ||
			tx.orderId.toLowerCase().includes(q)
		);
	});

	const totalDisbursed = transactions
		.filter((tx) => tx.transactionType === "DISBURSED")
		.reduce((sum, tx) => sum + tx.amount, 0);
	const totalReconciled = transactions
		.filter((tx) => tx.transactionType === "RECONCILED")
		.reduce((sum, tx) => sum + tx.amount, 0);
	const pendingAmount = transactions
		.filter(
			(tx) => tx.transactionType === "DISBURSED" && !tx.reconciliationBillId,
		)
		.reduce((sum, tx) => sum + tx.amount, 0);

	return (
		<div className="space-y-6">
			{/* Stats */}
			<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
				<Card>
					<CardHeader>
						<CardTitle className="text-sm font-medium">
							Total Disbursed
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-3xl font-bold">
							₹{totalDisbursed.toLocaleString("en-IN")}
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className="text-sm font-medium">
							Pending Reconciliation
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-3xl font-bold text-orange-600">
							₹{pendingAmount.toLocaleString("en-IN")}
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className="text-sm font-medium">
							Total Reconciled
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-3xl font-bold text-green-600">
							₹{totalReconciled.toLocaleString("en-IN")}
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Table */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<div>
						<CardTitle>Cash Advance Transactions</CardTitle>
						<CardDescription>
							All disbursements, reconciliations, and refunds
						</CardDescription>
					</div>
					<Button
						variant="outline"
						size="sm"
						onClick={() => { setLoading(true); void fetchTransactions(); }}
						disabled={loading}>
						<RefreshCw
							className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
						/>
						Refresh
					</Button>
				</CardHeader>
				<CardContent>
					<div className="flex gap-4 mb-6">
						<div className="flex-1 relative">
							<Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
							<Input
								placeholder="Search by employee, transaction or order ID..."
								value={searchTerm}
								onChange={(e) => setSearchTerm(e.target.value)}
								className="pl-10"
							/>
						</div>
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
										<TableHead>ID</TableHead>
										<TableHead>Employee</TableHead>
										<TableHead>Order ID</TableHead>
										<TableHead className="text-right">Amount (₹)</TableHead>
										<TableHead>Type</TableHead>
										<TableHead>Date</TableHead>
										<TableHead className="text-right">Action</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{filteredTransactions.map((tx) => (
										<TableRow key={tx.id}>
											<TableCell className="font-mono text-xs">
												{tx.id.slice(0, 8)}…
											</TableCell>
											<TableCell>
												<div>
													<p className="font-medium">{tx.employee.fullName}</p>
													<p className="text-xs text-gray-500">
														{tx.employee.email}
													</p>
												</div>
											</TableCell>
											<TableCell className="font-mono text-xs">
												{tx.orderId.slice(0, 8)}…
											</TableCell>
											<TableCell className="text-right font-medium">
												₹{tx.amount.toLocaleString("en-IN")}
											</TableCell>
											<TableCell>
												<Badge className={TYPE_COLORS[tx.transactionType]}>
													{tx.transactionType}
												</Badge>
											</TableCell>
											<TableCell className="text-sm text-gray-600">
												{new Date(tx.createdAt).toLocaleDateString("en-IN")}
											</TableCell>
											<TableCell className="text-right">
												<Dialog>
													<DialogTrigger asChild>
														<Button variant="outline" size="sm">
															Details
														</Button>
													</DialogTrigger>
													<DialogContent>
														<DialogHeader>
															<DialogTitle>Transaction Details</DialogTitle>
															<DialogDescription>
																{tx.employee.fullName} — {tx.transactionType}
															</DialogDescription>
														</DialogHeader>
														<div className="space-y-4">
															<div className="grid grid-cols-2 gap-4 text-sm">
																<div>
																	<p className="text-gray-600">Amount</p>
																	<p className="text-2xl font-bold">
																		₹{tx.amount.toLocaleString("en-IN")}
																	</p>
																</div>
																<div>
																	<p className="text-gray-600">Type</p>
																	<Badge
																		className={TYPE_COLORS[tx.transactionType]}>
																		{tx.transactionType}
																	</Badge>
																</div>
															</div>
															<div className="border-t pt-4 space-y-2 text-sm">
																<div className="flex justify-between">
																	<span className="text-gray-600">
																		Order ID:
																	</span>
																	<span className="font-mono text-xs">
																		{tx.orderId}
																	</span>
																</div>
																{tx.reconciliationBillId && (
																	<div className="flex justify-between">
																		<span className="text-gray-600">
																			Bill ID:
																		</span>
																		<span className="font-mono text-xs">
																			{tx.reconciliationBillId.slice(0, 8)}…
																		</span>
																	</div>
																)}
																{tx.description && (
																	<div className="flex justify-between">
																		<span className="text-gray-600">Note:</span>
																		<span>{tx.description}</span>
																	</div>
																)}
																<div className="flex justify-between">
																	<span className="text-gray-600">Date:</span>
																	<span>
																		{new Date(tx.createdAt).toLocaleString(
																			"en-IN",
																		)}
																	</span>
																</div>
															</div>
														</div>
													</DialogContent>
												</Dialog>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
							{filteredTransactions.length === 0 && (
								<div className="text-center py-8 text-gray-500">
									No transactions found
								</div>
							)}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
