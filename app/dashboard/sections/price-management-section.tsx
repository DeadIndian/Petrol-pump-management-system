"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
	AlertCircle,
	CheckCircle,
	RefreshCw,
	Loader2,
	TrendingUp,
	TrendingDown,
	Minus,
	Fuel,
} from "lucide-react";
import { api } from "@/lib/api-client";

import FuelPricesSection from "./fuel-prices-section";

type FuelType = "PETROL" | "DIESEL";

interface PriceStatus {
    priceId: string | null;
	fuelType: FuelType;
	currentPrice: number | null;
	lastUpdated: string | null;
	needsUpdate: boolean;
	hoursOverdue: number;
}

interface PriceHistory {
	id: string;
	fuelType: FuelType;
	pricePerLiter: number;
	date: string;
	createdAt: string;
	setBy?: { fullName: string };
}

const FUEL_CONFIG: Record<
	FuelType,
	{ label: string; color: string; bg: string; border: string }
> = {
	PETROL: {
		label: "Petrol",
		color: "text-orange-700",
		bg: "bg-orange-50",
		border: "border-orange-200",
	},
	DIESEL: {
		label: "Diesel",
		color: "text-blue-600",
		bg: "bg-blue-50",
		border: "border-blue-200",
	},
};

function PriceDelta({ history }: { history: PriceHistory[] }) {
	if (history.length < 2) return null;
	const delta = history[0].pricePerLiter - history[1].pricePerLiter;
	if (delta === 0)
		return <Minus className="h-4 w-4 text-gray-400 inline ml-1" />;
	return delta > 0 ? (
		<span className="text-xs text-red-600 font-medium ml-2">
			<TrendingUp className="h-3 w-3 inline" /> +₹{delta.toFixed(2)} from prev
		</span>
	) : (
		<span className="text-xs text-green-600 font-medium ml-2">
			<TrendingDown className="h-3 w-3 inline" /> ₹{delta.toFixed(2)} from prev
		</span>
	);
}

function FuelCard({
	status,
	history,
	onPriceSet,
}: {
	status: PriceStatus;
	history: PriceHistory[];
	onPriceSet: () => void;
}) {
	const [inputPrice, setInputPrice] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [success, setSuccess] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const cfg = FUEL_CONFIG[status.fuelType];

	const handleSet = async () => {
		const parsed = parseFloat(inputPrice);
		if (!inputPrice || isNaN(parsed) || parsed <= 0) {
			setErr("Enter a valid price");
			return;
		}
		setSubmitting(true);
		setErr(null);
		try {
			if (!status.needsUpdate && status.priceId) {
                await api.put("/api/admin/prices", { priceId: status.priceId, newPricePerLiter: parsed });
            } else {
                await api.post("/api/admin/prices", { fuelType: status.fuelType, pricePerLiter: parsed });
            }
			setInputPrice("");
			setSuccess(true);
			setTimeout(() => setSuccess(false), 3000);
			onPriceSet();
		} catch (e: any) {
			setErr(e.message || "Failed to set price");
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<Card
			data-testid={`fuel-${status.fuelType}`} className={`border-2 ${status.needsUpdate ? "border-red-300" : "border-green-200"}`}>
			<CardHeader className="pb-3">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="flex items-center gap-2">
						<div className={`p-2 rounded-lg ${cfg.bg}`}>
							<Fuel className={`h-5 w-5 ${cfg.color}`} />
						</div>
						<CardTitle className="text-xl">{cfg.label}</CardTitle>
					</div>
					{status.needsUpdate ? (
						<Badge className="bg-red-100 text-red-700 border border-red-200">
							<AlertCircle className="h-3 w-3 mr-1" />
							Needs Update
						</Badge>
					) : (
						<Badge className="bg-green-100 text-green-700 border border-green-200">
							<CheckCircle className="h-3 w-3 mr-1" />
							Set Today
						</Badge>
					)}
				</div>
			</CardHeader>
			<CardContent className="space-y-5">
				{/* Current Price Display */}
				<div className={`rounded-xl p-4 ${cfg.bg} ${cfg.border} border`}>
					<p className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-1">
						Today&apos;s Price
					</p>
					<div className="flex items-baseline gap-1">
						<span className={`text-4xl font-bold ${cfg.color}`}>
							{status.currentPrice ? `₹${status.currentPrice.toFixed(2)}` : "—"}
						</span>
						{status.currentPrice && (
							<span className="text-sm text-gray-600">/L</span>
						)}
					</div>
					<div className="flex items-center mt-1">
						{status.currentPrice && <PriceDelta history={history} />}
					</div>
					{status.lastUpdated && (
						<p className="text-xs text-gray-600 mt-2">
							Updated {new Date(status.lastUpdated).toLocaleString("en-IN")}
						</p>
					)}
					{status.needsUpdate && status.hoursOverdue > 0 && (
						<p className="text-xs text-red-600 font-medium mt-1">
							⚠ Overdue by {status.hoursOverdue}h — set today&apos;s price below
						</p>
					)}
				</div>

				{/* Inline Set Price */}
				<div className="space-y-2">
					<p className="text-sm font-medium text-gray-700">
						{status.needsUpdate ? "Set today's price" : "Update today's price"}
					</p>
					<div className="flex flex-wrap gap-2">
						<div className="relative min-w-0 flex-1">
							<span className="absolute left-3 top-2.5 text-gray-600 text-sm font-medium">
								₹
							</span>
							<Input
								type="number"
                                aria-label={`${cfg.label} price per litre`}
								step="0.01"
								min="0"
								placeholder="0.00"
								value={inputPrice}
								onChange={(e) => {
									setInputPrice(e.target.value);
									setErr(null);
								}}
								className="pl-7"
								onKeyDown={(e) => e.key === "Enter" && handleSet()}
							/>
						</div>
						<Button
							aria-label={`${status.needsUpdate ? "Set" : "Update"} ${cfg.label} price`} onClick={handleSet}
							disabled={submitting || !inputPrice}
							className={success ? "bg-green-600 hover:bg-green-700" : ""}>
							{submitting ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : success ? (
								<CheckCircle className="h-4 w-4" />
							) : (
								"Set"
							)}
						</Button>
					</div>
					{err && <p className="text-xs text-red-600">{err}</p>}
					{success && (
						<p className="text-xs text-green-600">Price updated successfully</p>
					)}
				</div>

				{/* Mini history in the card */}
				{history.length > 0 && (
					<div className="border-t pt-3">
						<p className="text-xs text-gray-600 mb-2 font-medium">
							Recent history
						</p>
						<div className="space-y-1.5">
							{history.slice(0, 4).map((h, i) => (
								<div
									key={h.id}
									className="flex justify-between items-center text-sm">
									<span className="text-gray-600">
										{new Date(h.date).toLocaleDateString("en-IN", {
											day: "numeric",
											month: "short",
										})}
									</span>
									<span
										className={`font-semibold ${i === 0 ? cfg.color : "text-gray-700"}`}>
										₹{h.pricePerLiter.toFixed(2)}
									</span>
								</div>
							))}
						</div>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

export default function PriceManagementSection() {
	const [priceStatus, setPriceStatus] = useState<PriceStatus[]>([]);
	const [petrolHistory, setPetrolHistory] = useState<PriceHistory[]>([]);
	const [dieselHistory, setDieselHistory] = useState<PriceHistory[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback((signal?: AbortSignal) => Promise.all([
    api.get<{ status: PriceStatus[] }>("/api/admin/prices", { signal }),
    api.get<{ history: PriceHistory[] }>("/api/admin/prices/history/PETROL?days=14", { signal }),
    api.get<{ history: PriceHistory[] }>("/api/admin/prices/history/DIESEL?days=14", { signal }),
  ]).then(([statusData, petrolData, dieselData]) => { if (!signal?.aborted) { setPriceStatus(statusData.status); setPetrolHistory(petrolData.history); setDieselHistory(dieselData.history); setError(null); } })
    .catch(cause => { if (!signal?.aborted) setError(cause.message || "Failed to load prices"); })
    .finally(() => { if (!signal?.aborted) setLoading(false); }), []);

	useEffect(() => {
    const controller = new AbortController();
    void fetchAll(controller.signal);
    return () => controller.abort();
  }, [fetchAll]);

	const petrolStatus = priceStatus.find((p) => p.fuelType === "PETROL");
	const dieselStatus = priceStatus.find((p) => p.fuelType === "DIESEL");

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 className="text-lg font-semibold text-gray-900">
						Fuel Price Management
					</h2>
					<p className="text-sm text-gray-600">
						Set daily prices for each fuel type. Prices are used for billing.
					</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					onClick={() => { setLoading(true); void fetchAll(); }}
					disabled={loading}>
					<RefreshCw
						className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
					/>
					Refresh
				</Button>
			</div>

			{error && (
				<div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm flex items-center gap-2">
					<AlertCircle className="h-4 w-4 flex-shrink-0" />
					{error}
				</div>
			)}

			{loading ? (
				<div className="flex items-center justify-center py-20">
					<Loader2 className="h-8 w-8 animate-spin text-gray-400" />
				</div>
			) : (
				<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
					{petrolStatus && (
						<FuelCard
							status={petrolStatus}
							history={petrolHistory}
							onPriceSet={fetchAll}
						/>
					)}
					{dieselStatus && (
						<FuelCard
							status={dieselStatus}
							history={dieselHistory}
							onPriceSet={fetchAll}
						/>
					)}
				</div>
			)}
            <FuelPricesSection historyOnly key={priceStatus.map(item => `${item.fuelType}-${item.currentPrice}`).join("-")} />
		</div>
	);
}
