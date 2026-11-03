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
import { Label } from "@/components/ui/label";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	ArrowLeft,
	RefreshCw,
	Loader2,
	Plus,
	Calendar,
	Car,
	Hash,
} from "lucide-react";
import { api } from "@/lib/api-client";

interface Order {
	id: string;
	vehicleNumber: string;
	indentNumber: number | null;
	fuelType: string;
	amountRequested: number | null;
	quantityRequested: number | null;
	cash: number;
	quantityDelivered: number | null;
	pricePerLiter: number | null;
	totalAmount: number | null;
	status: string;
	deliveredAt: string | null;
	completedAt: string | null;
	createdAt: string;
}

interface Payment {
	id: string;
	amount: number;
	paymentMethod: string | null;
	paymentMethodNote: string | null;
	reference: string | null;
	notes: string | null;
	paymentDate: string;
	createdAt: string;
}

interface Vehicle {
	vehicleNumber: string;
	orderCount: number;
}

interface CustomerProfile {
	id: string;
	currentBalance: number;
	totalOrders: number;
	totalPurchases: number;
	totalPayments: number;
	indentStart: number | null;
	indentEnd: number | null;
	currentIndent: number | null;
	payments: Payment[];
}

interface Customer {
	id: string;
	fullName: string;
	email: string;
	phone: string | null;
	customerProfile: CustomerProfile | null;
}

const STATUS_COLORS: Record<string, string> = {
	PENDING: "bg-yellow-100 text-yellow-800",
	DELIVERED: "bg-blue-100 text-blue-800",
	COMPLETED: "bg-green-100 text-green-800",
};

export default function CustomerDetailPage({
	params,
}: {
	params: { id: string };
}) {
	const router = useRouter();
	const [customer, setCustomer] = useState<Customer | null>(null);
	const [orderOffset, setOrderOffset] = useState(0);
    const [orderTotal, setOrderTotal] = useState(0);
    const [paymentOffset, setPaymentOffset] = useState(0);
    const [paymentTotal, setPaymentTotal] = useState(0);
    const [reversing, setReversing] = useState<string | null>(null);
    const [orders, setOrders] = useState<Order[]>([]);
	const [vehicles, setVehicles] = useState<Vehicle[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// Filters
	const [statusFilter, setStatusFilter] = useState<string>("all");
	const [vehicleFilter, setVehicleFilter] = useState<string>("all");
	const [startDate, setStartDate] = useState<string>("");
	const [endDate, setEndDate] = useState<string>("");

	// Add payment dialog
	const [showPaymentDialog, setShowPaymentDialog] = useState(false);
	const [paymentAmount, setPaymentAmount] = useState("");
	const [paymentMethod, setPaymentMethod] = useState("");
	const [paymentMethodNote, setPaymentMethodNote] = useState("");
	const [paymentReference, setPaymentReference] = useState("");
	const [paymentNotes, setPaymentNotes] = useState("");
	const [paymentDate, setPaymentDate] = useState("");
	const [submittingPayment, setSubmittingPayment] = useState(false);

	// Indent Settings
	const [showIndentDialog, setShowIndentDialog] = useState(false);
	const [indentStart, setIndentStart] = useState("");
	const [indentEnd, setIndentEnd] = useState("");
	const [submittingIndent, setSubmittingIndent] = useState(false);

  const fetchCustomerData = useCallback((signal?: AbortSignal) => {
    const query = new URLSearchParams({ limit: "20", offset: String(orderOffset) });
    if (statusFilter !== "all") query.set("status", statusFilter);
    if (vehicleFilter !== "all") query.set("vehicleNumber", vehicleFilter);
    if (startDate) query.set("startDate", startDate);
    if (endDate) query.set("endDate", endDate);
    return Promise.all([
      api.get<{ customer: Customer; orders: Order[]; vehicles: Vehicle[]; pagination: { total: number } }>(`/api/customers/${params.id}?${query}`, { signal }),
      api.get<{ payments: Payment[]; pagination: { total: number } }>(`/api/customers/${params.id}/payments?limit=20&offset=${paymentOffset}`, { signal }),
    ]).then(([data, history]) => {
      if (signal?.aborted) return;
      if (data.customer.customerProfile) data.customer.customerProfile.payments = history.payments;
      setPaymentTotal(history.pagination.total); setOrderTotal(data.pagination.total);
      setCustomer(data.customer); setOrders(data.orders); setVehicles(data.vehicles); setError(null);
      if (data.customer.customerProfile) {
        setIndentStart(data.customer.customerProfile.indentStart?.toString() || "");
        setIndentEnd(data.customer.customerProfile.indentEnd?.toString() || "");
      }
    }).catch(cause => { if (!signal?.aborted) setError(cause.message || "Failed to fetch customer data"); })
      .finally(() => { if (!signal?.aborted) setLoading(false); });
  }, [params.id, statusFilter, vehicleFilter, startDate, endDate, orderOffset, paymentOffset]);

	useEffect(() => {
    const controller = new AbortController();
    void fetchCustomerData(controller.signal);
    return () => controller.abort();
  }, [fetchCustomerData]);

	const handleAddPayment = async () => {
		if (!paymentAmount || parseFloat(paymentAmount) <= 0) {
			setError("Please enter a valid payment amount");
			return;
		}

		setSubmittingPayment(true);
		try {
			await api.post(`/api/customers/${params.id}/payments`, {
				amount: parseFloat(paymentAmount),
				paymentMethod: paymentMethod || undefined,
				paymentMethodNote: paymentMethodNote || undefined,
				reference: paymentReference || undefined,
				notes: paymentNotes || undefined,
				paymentDate: paymentDate || undefined,
			});

			// Reset form
			setPaymentAmount("");
			setPaymentMethod("");
			setPaymentMethodNote("");
			setPaymentReference("");
			setPaymentNotes("");
			setPaymentDate("");
			setShowPaymentDialog(false);

			// Refresh data
			await fetchCustomerData();
		} catch (err: any) {
			setError(err.message || "Failed to add payment");
		} finally {
			setSubmittingPayment(false);
		}
	};

	const handleUpdateIndent = async () => {
		if (!indentStart || !indentEnd || !Number.isInteger(Number(indentStart)) || !Number.isInteger(Number(indentEnd)) || Number(indentStart) <= 0 || Number(indentEnd) < Number(indentStart)) {
			setError("Enter a whole-number range with end greater than or equal to start.");
			return;
		}

		setSubmittingIndent(true);
		try {
			await api.post(`/api/admin/users/${params.id}/indent`, {
				indentStart: parseInt(indentStart),
				indentEnd: parseInt(indentEnd),
			});

			setShowIndentDialog(false);
			await fetchCustomerData();
		} catch (err: any) {
			setError(err.message || "Failed to update indent range");
		} finally {
			setSubmittingIndent(false);
		}
	};

	if (loading && !customer) {
		return (
			<div className="flex items-center justify-center h-full py-20">
				<Loader2 className="h-8 w-8 animate-spin text-gray-400" />
			</div>
		);
	}

	if (!customer) {
		return (
			<div className="p-8">
				<div className="bg-red-50 border border-red-200 text-red-700 rounded p-4">
					{error || "Customer not found"}
				</div>
			</div>
		);
	}

	const balance = customer.customerProfile?.currentBalance || 0;
	const payments = customer.customerProfile?.payments || [];

	return (
		<main className="mx-auto max-w-7xl min-w-0 px-4 py-5 sm:p-8 space-y-6">
            {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
			{/* Header */}
			<div className="flex flex-wrap items-center justify-between gap-4">
				<div className="flex flex-wrap min-w-0 items-center gap-4">
					<Button
						variant="ghost"
						onClick={() => router.push("/dashboard?tab=billing")}>
						<ArrowLeft className="h-4 w-4 mr-2" />
						Back
					</Button>
					<div>
						<h1 className="text-2xl sm:text-3xl font-bold break-words">{customer.fullName}</h1>
						<p className="text-gray-600 break-all">{customer.email}</p>
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Dialog open={showIndentDialog} onOpenChange={setShowIndentDialog}>
						<DialogTrigger asChild>
							<Button variant="outline">
								<Hash className="h-4 w-4 mr-2" />
								Configure Indent
							</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Configure Indent Number Range</DialogTitle>
								<DialogDescription>
									Set the range of indent numbers the customer will be assigned for each order sequentially.
								</DialogDescription>
							</DialogHeader>
							<div className="space-y-4">
                                {error && <p role="alert" className="text-red-800">{error}</p>}
								<div>
									<Label htmlFor="indentStart">Start Number</Label>
									<Input
										id="indentStart"
										type="number"
										placeholder="e.g. 2000"
										value={indentStart}
										onChange={(e) => setIndentStart(e.target.value)}
									/>
								</div>
								<div>
									<Label htmlFor="indentEnd">End Number</Label>
									<Input
										id="indentEnd"
										type="number"
										placeholder="e.g. 3000"
										value={indentEnd}
										onChange={(e) => setIndentEnd(e.target.value)}
									/>
								</div>
								<Button
									className="w-full"
									onClick={handleUpdateIndent}
									disabled={submittingIndent}>
									{submittingIndent ? (
										<Loader2 className="h-4 w-4 mr-2 animate-spin" />
									) : null}
									Save Range
								</Button>
							</div>
						</DialogContent>
					</Dialog>

					<Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
						<DialogTrigger asChild>
							<Button>
								<Plus className="h-4 w-4 mr-2" />
								Add Payment
							</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Add Payment</DialogTitle>
								<DialogDescription>
									Record a payment from {customer.fullName}
								</DialogDescription>
							</DialogHeader>
						<div className="space-y-4">
                                {error && <p role="alert" className="text-red-800">{error}</p>}
							<div>
								<Label htmlFor="amount">Amount (₹) *</Label>
								<Input
									id="amount"
                                    step="0.01" min="0.01" inputMode="decimal"
									type="number"
									placeholder="0.00"
									value={paymentAmount}
									onChange={(e) => setPaymentAmount(e.target.value)}
								/>
							</div>
							<div>
								<Label htmlFor="paymentMethod">Payment Method</Label>
								<Select value={paymentMethod} onValueChange={setPaymentMethod}>
									<SelectTrigger aria-label="Payment method">
										<SelectValue placeholder="Select method" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="CASH">Cash</SelectItem>
										<SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
										<SelectItem value="CHEQUE">Cheque</SelectItem>
										<SelectItem value="UPI">UPI</SelectItem>
										<SelectItem value="OTHER">Other</SelectItem>
									</SelectContent>
								</Select>
							</div>
							{paymentMethod === "OTHER" && (
								<div>
									<Label htmlFor="methodNote">Payment Method Note</Label>
									<Input
										id="methodNote"
										placeholder="Specify payment method"
										value={paymentMethodNote}
										onChange={(e) => setPaymentMethodNote(e.target.value)}
									/>
								</div>
							)}
							<div>
								<Label htmlFor="reference">Reference Number</Label>
								<Input
									id="reference"
									placeholder="Transaction ID, Cheque number, etc."
									value={paymentReference}
									onChange={(e) => setPaymentReference(e.target.value)}
								/>
							</div>
							<div>
								<Label htmlFor="paymentDate">Payment Date</Label>
								<Input
									id="paymentDate"
									type="date"
									value={paymentDate}
									onChange={(e) => setPaymentDate(e.target.value)}
								/>
							</div>
							<div>
								<Label htmlFor="notes">Notes</Label>
								<Input
									id="notes"
									placeholder="Additional notes"
									value={paymentNotes}
									onChange={(e) => setPaymentNotes(e.target.value)}
								/>
							</div>
							<Button
								className="w-full"
								onClick={handleAddPayment}
								disabled={submittingPayment}>
								{submittingPayment ? (
									<Loader2 className="h-4 w-4 mr-2 animate-spin" />
								) : null}
								Add Payment
							</Button>
						</div>
					</DialogContent>
				</Dialog>
			</div>
			</div>

			{/* Customer Summary */}
			<div className="grid grid-cols-1 md:grid-cols-4 gap-6">
				<Card>
					<CardHeader>
						<CardTitle className="text-sm font-medium">
							Current Balance
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div
							className={`text-3xl font-bold ${
								balance < 0
									? "text-red-600"
									: balance > 0
										? "text-green-600"
										: "text-gray-600"
							}`}>
							₹{Math.abs(balance).toLocaleString("en-IN")}
						</div>
						<p className="text-sm text-gray-500 mt-1">
							{balance < 0 ? "Owes" : balance > 0 ? "Credit" : "Clear"}
						</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className="text-sm font-medium">Total Orders</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-3xl font-bold">
							{customer.customerProfile?.totalOrders || 0}
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className="text-sm font-medium">
							Total Purchases
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							₹
							{(customer.customerProfile?.totalPurchases || 0).toLocaleString(
								"en-IN",
							)}
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className="text-sm font-medium">Payments Made</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold text-green-600">
							₹
							{(customer.customerProfile?.totalPayments || 0).toLocaleString(
								"en-IN",
							)}
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className="text-sm font-medium">Indent Info</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold text-blue-600">
							{customer.customerProfile?.currentIndent != null ? (
								<>{customer.customerProfile.currentIndent} / {customer.customerProfile.indentEnd}</>
							) : (
								<span className="text-gray-600 text-lg">Not configured</span>
							)}
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Vehicles */}
			<Card>
				<CardHeader>
					<CardTitle className="flex flex-wrap items-center gap-2">
						<Car className="h-5 w-5" />
						Vehicles
					</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex flex-wrap gap-2">
						{vehicles.map((vehicle) => (
							<Badge
								key={vehicle.vehicleNumber}
								variant="outline"
								className="text-sm py-2 px-3">
								{vehicle.vehicleNumber} ({vehicle.orderCount} orders)
							</Badge>
						))}
						{vehicles.length === 0 && (
							<p className="text-gray-500">No vehicles found</p>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Orders Table */}
			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-center justify-between gap-4">
						<CardTitle>Order History</CardTitle>
						<Button
							variant="outline"
							size="sm"
							onClick={() => { setLoading(true); void fetchCustomerData(); }}
							disabled={loading}>
							<RefreshCw
								className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
							/>
							Refresh
						</Button>
					</div>
					<CardDescription>Filter and view all orders</CardDescription>
				</CardHeader>
				<CardContent>
					{/* Filters */}
					<div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
						<div>
							<Label htmlFor="statusFilter">Status</Label>
							<Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setOrderOffset(0); }}>
								<SelectTrigger aria-label="Order status filter">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all"> All</SelectItem>
									<SelectItem value="PENDING">Pending</SelectItem>
									<SelectItem value="COMPLETED">Completed</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div>
							<Label htmlFor="vehicleFilter">Vehicle</Label>
							<Select value={vehicleFilter} onValueChange={(value) => { setVehicleFilter(value); setOrderOffset(0); }}>
								<SelectTrigger aria-label="Vehicle filter">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Vehicles</SelectItem>
									{vehicles.map((v) => (
										<SelectItem key={v.vehicleNumber} value={v.vehicleNumber}>
											{v.vehicleNumber}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div>
							<Label htmlFor="startDate">Start Date</Label>
							<Input
								id="startDate"
								type="date"
								value={startDate}
								onChange={(e) => { setStartDate(e.target.value); setOrderOffset(0); }}
							/>
						</div>
						<div>
							<Label htmlFor="endDate">End Date</Label>
							<Input
								id="endDate"
								type="date"
								value={endDate}
								onChange={(e) => { setEndDate(e.target.value); setOrderOffset(0); }}
							/>
						</div>
					</div>

					{loading ? (
						<div className="flex items-center justify-center py-12">
							<Loader2 className="h-8 w-8 animate-spin text-gray-400" />
						</div>
					) : (
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Date</TableHead>
										<TableHead>Indent No.</TableHead>
										<TableHead>Vehicle</TableHead>
										<TableHead>Fuel</TableHead>
										<TableHead className="text-right">Qty (L)</TableHead>
										<TableHead className="text-right">Price/L</TableHead>
										<TableHead className="text-right">Cash</TableHead>
										<TableHead className="text-right">Total</TableHead>
										<TableHead>Status</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{orders.map((order) => (
										<TableRow key={order.id}>
											<TableCell className="text-sm">
												{new Date(order.createdAt).toLocaleDateString("en-IN")}
											</TableCell>
											<TableCell className="font-medium">
												{order.indentNumber ? `#${order.indentNumber}` : "—"}
											</TableCell>
											<TableCell className="font-medium">
												{order.vehicleNumber}
											</TableCell>
											<TableCell>{order.fuelType}</TableCell>
											<TableCell className="text-right">
												{order.quantityDelivered?.toFixed(2) || "—"}
											</TableCell>
											<TableCell className="text-right">
												{order.pricePerLiter
													? `₹${order.pricePerLiter.toFixed(2)}`
													: "—"}
											</TableCell>
											<TableCell className="text-right font-medium text-orange-700">
												{order.cash ? `₹${order.cash.toLocaleString("en-IN")}` : "—"}
											</TableCell>
											<TableCell className="text-right font-medium">
												{order.totalAmount
													? `₹${order.totalAmount.toLocaleString("en-IN")}`
													: "—"}
											</TableCell>
											<TableCell>
												<Badge className={STATUS_COLORS[order.status]}>
													{order.status}
												</Badge>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
							{orders.length === 0 && (
								<div className="text-center py-8 text-gray-500">
									No orders found
								</div>
							)}
						</div>
					)}
                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-600">{orderTotal} matching orders</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={orderOffset === 0 || loading} onClick={() => setOrderOffset(orderOffset - 20)}>Previous orders</Button><Button variant="outline" disabled={orderOffset + 20 >= orderTotal || loading} onClick={() => setOrderOffset(orderOffset + 20)}>Next orders</Button></div></div>
				</CardContent>
			</Card>

            <Card><CardHeader><CardTitle className="flex items-center gap-2"><Calendar className="h-5 w-5" />Payment History</CardTitle></CardHeader><CardContent>
                {payments.length ? <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Amount</TableHead><TableHead>Method</TableHead><TableHead>Reference / notes</TableHead><TableHead>Action</TableHead></TableRow></TableHeader><TableBody>{payments.map(payment => <TableRow key={payment.id}><TableCell>{new Date(payment.paymentDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</TableCell><TableCell>₹{payment.amount.toFixed(2)}</TableCell><TableCell>{payment.paymentMethod?.replace(/_/g, " ") || "Not specified"}{payment.paymentMethodNote && <p>{payment.paymentMethodNote}</p>}</TableCell><TableCell>{payment.reference || "—"}{payment.notes && <p>{payment.notes}</p>}</TableCell><TableCell><Button variant="outline" disabled={Boolean(reversing)} onClick={async () => {
                    if (!window.confirm("Reverse this payment? The customer's amount due will increase by the payment amount.")) return;
                    setReversing(payment.id); setError(null);
                    try { await api.delete(`/api/bills/${payment.id}`); await fetchCustomerData(); }
                    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not reverse payment"); }
                    finally { setReversing(null); }
                }}>{reversing === payment.id ? "Reversing…" : "Reverse payment"}</Button></TableCell></TableRow>)}</TableBody></Table> : <p className="py-4 text-slate-600">No payment history.</p>}
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-600">{paymentTotal} payments</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={paymentOffset === 0 || loading} onClick={() => setPaymentOffset(paymentOffset - 20)}>Previous payments</Button><Button variant="outline" disabled={paymentOffset + 20 >= paymentTotal || loading} onClick={() => setPaymentOffset(paymentOffset + 20)}>Next payments</Button></div></div>
            </CardContent></Card>
        </main>
    );
}
