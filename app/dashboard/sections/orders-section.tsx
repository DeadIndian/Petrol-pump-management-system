"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { WebUser, WebOrder } from "@/lib/web-types";
import { money } from "@/lib/web-types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import OrderForm from "../components/order-form";

export default function OrdersSection({ user }: { user: WebUser }) {
  const [orders, setOrders] = useState<WebOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(user.role === "EMPLOYEE" ? "PENDING" : "all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<WebOrder | null>(null);
  const [quantity, setQuantity] = useState("");
  const [completing, setCompleting] = useState(false);
  const [deliveryError, setDeliveryError] = useState("");
  const load = useCallback((signal?: AbortSignal) => {
    const query = new URLSearchParams({ limit: "20", offset: String(offset), search });
    if (status !== "all") query.set("status", status);
    return api.get<{ orders: WebOrder[]; pagination: { total: number } }>(`/api/orders?${query}`, { signal })
      .then(data => { if (!signal?.aborted) { setOrders(data.orders); setTotal(data.pagination.total); setError(""); } })
      .catch(cause => { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Could not load orders"); })
      .finally(() => { if (!signal?.aborted) setLoading(false); });
  }, [offset, search, status]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = setInterval(() => void load(controller.signal), 30000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [load]);
  async function complete(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; setCompleting(true); setDeliveryError("");
    try {
      await api.patch(`/api/orders/${selected.id}`, { quantityDelivered: Number(quantity) });
      setSelected(null); setNotice("Delivery completed. The customer balance has been updated."); await load();
    } catch (cause) { setDeliveryError(cause instanceof Error ? cause.message : "Could not complete delivery"); }
    finally { setCompleting(false); }
  }
  const canCreate = user.role !== "EMPLOYEE";
  return <section className="space-y-5" aria-labelledby="orders-title">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="orders-title" className="text-xl font-semibold">{user.role === "CUSTOMER" ? "My orders" : "Fuel orders"}</h2>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => { setLoading(true); void load(); }} disabled={loading}>Refresh orders</Button>{canCreate && <Button onClick={() => setCreating(true)}>New order</Button>}</div></div>
    {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-green-800">{notice}</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    <div className="grid gap-3 sm:grid-cols-[1fr_12rem]"><div className="space-y-1"><Label htmlFor="order-search">Search orders</Label><Input id="order-search" placeholder="Vehicle, indent, order ID or customer" value={search} onChange={event => { setSearch(event.target.value); setOffset(0); setLoading(true); }} /></div>
      <div className="space-y-1"><Label htmlFor="order-status">Order status</Label><select id="order-status" className="native-select" value={status} onChange={event => { setStatus(event.target.value); setOffset(0); setLoading(true); }}><option value="all">All statuses</option><option value="PENDING">Pending</option><option value="DELIVERED">Delivered</option><option value="COMPLETED">Completed</option></select></div></div>
    <Card><CardHeader><CardTitle className="text-base">{total} matching {total === 1 ? "order" : "orders"}</CardTitle></CardHeader><CardContent>
      {loading && orders.length === 0 ? <p role="status" className="py-8 text-slate-600">Loading orders…</p> : orders.length === 0 ? <p className="py-8 text-slate-600">{canCreate ? "No orders match. Place an order or adjust your filters." : "No pending deliveries. Refresh to check for new orders."}</p> : <Table>
        <TableHeader><TableRow><TableHead>Vehicle / indent</TableHead><TableHead>Customer</TableHead><TableHead>Fuel / request</TableHead><TableHead>Extra cash</TableHead><TableHead>Status / total</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
        <TableBody>{orders.map(order => <TableRow key={order.id}><TableCell><p className="font-medium">{order.vehicleNumber}</p><p className="text-sm text-slate-600">Indent {order.indentNumber ?? "—"}</p></TableCell>
          <TableCell>{order.customer.fullName}</TableCell><TableCell>{order.fuelType}<p>{order.quantityRequested != null ? `${order.quantityRequested} L` : money(order.amountRequested || 0)}</p></TableCell>
          <TableCell>{money(order.cash)}</TableCell><TableCell><Badge className={order.status === "PENDING" ? "bg-amber-100 text-amber-900" : "bg-green-100 text-green-900"}>{order.status}</Badge>{order.totalAmount != null && <p className="mt-1 font-medium">{money(order.totalAmount)}</p>}</TableCell>
          <TableCell><Button variant="outline" aria-label={`View order for ${order.vehicleNumber}`} onClick={() => { setSelected(order); setDeliveryError(""); setQuantity(order.quantityRequested?.toString() || ""); }}>View order</Button></TableCell></TableRow>)}</TableBody>
      </Table>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-600">Showing {total ? offset + 1 : 0}–{Math.min(offset + orders.length, total)} of {total}</p><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => { setLoading(true); setOffset(Math.max(0, offset - 20)); }} disabled={offset === 0 || loading}>Previous</Button><Button variant="outline" onClick={() => { setLoading(true); setOffset(offset + 20); }} disabled={offset + 20 >= total || loading}>Next</Button></div></div>
    </CardContent></Card>
    <Dialog open={creating} onOpenChange={setCreating}><DialogContent><DialogHeader><DialogTitle>Place a fuel order</DialogTitle><DialogDescription>Request fuel by quantity or amount, with any extra cash.</DialogDescription></DialogHeader><OrderForm user={user} onPlaced={() => { setCreating(false); setNotice("Order placed. Its indent number appears in your order list."); setOffset(0); setLoading(true); if (offset === 0) void load(); }} /></DialogContent></Dialog>
    <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open && !completing) setSelected(null); }}><DialogContent><DialogHeader><DialogTitle>Order {selected?.vehicleNumber}</DialogTitle><DialogDescription>Indent {selected?.indentNumber ?? "—"} · {selected?.status}</DialogDescription></DialogHeader>
      {selected && <><dl className="detail-list"><div><dt>Customer</dt><dd>{selected.customer.fullName}</dd></div><div><dt>Fuel</dt><dd>{selected.fuelType}</dd></div><div><dt>Requested</dt><dd>{selected.quantityRequested != null ? `${selected.quantityRequested} L` : money(selected.amountRequested || 0)}</dd></div><div><dt>Extra cash</dt><dd>{money(selected.cash)}</dd></div><div><dt>Placed</dt><dd>{new Date(selected.createdAt).toLocaleString("en-IN")}</dd></div>
        {selected.totalAmount != null && <><div><dt>Delivered</dt><dd>{selected.quantityDelivered} L</dd></div><div><dt>Delivery price</dt><dd>{money(selected.pricePerLiter || 0)} / L</dd></div><div><dt>Total charge</dt><dd>{money(selected.totalAmount)}</dd></div>{selected.fulfilledBy && <div><dt>Completed by</dt><dd>{selected.fulfilledBy.fullName}</dd></div>}</>}</dl>
        {user.role !== "CUSTOMER" && selected.status === "PENDING" && <form onSubmit={complete} className="space-y-4 border-t pt-4">{deliveryError && <p role="alert" className="text-red-800">{deliveryError}</p>}<div className="space-y-2"><Label htmlFor="delivered-quantity">Quantity delivered (L)</Label><Input id="delivered-quantity" type="number" inputMode="decimal" min="0.001" step="0.001" value={quantity} onChange={event => setQuantity(event.target.value)} required /></div><p className="text-sm text-slate-600">Completing delivery charges the customer for the delivered fuel plus extra cash. This action can be completed once.</p><Button type="submit" className="w-full" disabled={completing}>{completing ? "Completing delivery…" : "Complete delivery"}</Button></form>}</>}
    </DialogContent></Dialog>
  </section>;
}
