"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { WebPrice } from "@/lib/web-types";
import { money } from "@/lib/web-types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";

export default function FuelPricesSection({ historyOnly = false }: { historyOnly?: boolean }) {
  const [prices, setPrices] = useState<WebPrice[]>([]);
  const [history, setHistory] = useState<WebPrice[]>([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [fuel, setFuel] = useState("PETROL");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback((signal?: AbortSignal) => Promise.all([
    api.get<{ prices: WebPrice[] }>("/api/prices", { signal }),
    api.get<{ prices: WebPrice[]; pagination: { total: number } }>(`/api/prices/history?fuelType=${fuel}&limit=20&offset=${offset}`, { signal }),
  ]).then(([current, previous]) => { if (!signal?.aborted) { setPrices(current.prices); setHistory(previous.prices); setTotal(previous.pagination.total); setError(""); } })
    .catch(cause => { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Could not load prices"); })
    .finally(() => { if (!signal?.aborted) setLoading(false); }), [fuel, offset]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  return <section className="space-y-5">{!historyOnly && <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Fuel prices</h2><Button variant="outline" disabled={loading} onClick={() => { setLoading(true); void load(); }}>Refresh prices</Button></div>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    {!historyOnly && <div className="grid gap-4 sm:grid-cols-2">{["PETROL", "DIESEL"].map(type => { const price = prices.find(item => item.fuelType === type); return <Card key={type}><CardHeader><CardTitle>{type === "PETROL" ? "Petrol" : "Diesel"}</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{price ? `${money(price.pricePerLiter)} / L` : "Price not set"}</p>{price && <p className="mt-2 text-sm text-slate-600">Effective {new Date(price.date).toLocaleDateString("en-IN", { timeZone: "UTC" })}</p>}</CardContent></Card>; })}</div>}
    <Card><CardHeader className="flex flex-wrap flex-row items-center justify-between gap-3"><CardTitle>Price history</CardTitle><Button variant="outline" disabled={loading} onClick={() => { setLoading(true); void load(); }}>Refresh history</Button></CardHeader><CardContent><div className="mb-4 max-w-xs space-y-2"><Label htmlFor="history-fuel">Fuel type</Label><select id="history-fuel" className="native-select" value={fuel} onChange={event => { setFuel(event.target.value); setOffset(0); setLoading(true); }}><option value="PETROL">Petrol</option><option value="DIESEL">Diesel</option></select></div>{history.length ? <Table><TableHeader><TableRow><TableHead>Effective date</TableHead><TableHead>Price per litre</TableHead></TableRow></TableHeader><TableBody>{history.map(price => <TableRow key={price.id}><TableCell>{new Date(price.date).toLocaleDateString("en-IN", { timeZone: "UTC" })}</TableCell><TableCell>{money(price.pricePerLiter)}</TableCell></TableRow>)}</TableBody></Table> : <p className="text-slate-600">No price history is available.</p>}<div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-600">{total} price records</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!offset || loading} onClick={() => { setLoading(true); setOffset(offset - 20); }}>Previous prices</Button><Button variant="outline" disabled={offset + 20 >= total || loading} onClick={() => { setLoading(true); setOffset(offset + 20); }}>Next prices</Button></div></div></CardContent></Card>
  </section>;
}
