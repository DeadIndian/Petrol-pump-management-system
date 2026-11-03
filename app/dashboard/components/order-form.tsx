"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { WebUser, WebPrice } from "@/lib/web-types";
import { money } from "@/lib/web-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function OrderForm({ user, onPlaced }: { user: WebUser; onPlaced: () => void }) {
  const [customers, setCustomers] = useState<WebUser[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [mode, setMode] = useState("quantity");
  const [fuelType, setFuelType] = useState("PETROL");
  const [prices, setPrices] = useState<WebPrice[]>([]);
  const [amount, setAmount] = useState("");
  const [cash, setCash] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { api.get<{ prices: WebPrice[] }>("/api/prices").then(data => setPrices(data.prices)).catch(cause => setError(cause.message)); }, []);
  useEffect(() => {
    if (user.role !== "ADMIN") return;
    let active = true;
    api.get<{ users: WebUser[] }>(`/api/admin/users?role=CUSTOMER&limit=200&search=${encodeURIComponent(customerSearch)}`)
      .then(data => { if (active) setCustomers(data.users); }).catch(cause => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [customerSearch, user.role]);
  const price = prices.find(item => item.fuelType === fuelType)?.pricePerLiter;
  const estimate = mode === "amount" ? Number(amount) + Number(cash) : price ? Number(amount) * price + Number(cash) : null;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = event.currentTarget;
    try {
      await api.post("/api/orders", { vehicleNumber: new FormData(form).get("vehicleNumber"), fuelType,
        ...(user.role === "ADMIN" && { customerId }), cash: Number(cash),
        ...(mode === "quantity" ? { quantityRequested: Number(amount) } : { amountRequested: Number(amount) }),
      });
      form.reset(); setAmount(""); setCash("0"); onPlaced();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not place order"); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-5">
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    {user.role === "ADMIN" && <div className="space-y-2"><Label htmlFor="customer-search">Find a customer</Label>
      <Input id="customer-search" value={customerSearch} onChange={event => setCustomerSearch(event.target.value)} placeholder="Search name or email" />
      <Label htmlFor="order-customer">Customer</Label><select id="order-customer" className="native-select" value={customerId} onChange={event => setCustomerId(event.target.value)} required>
        <option value="">Choose a customer</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.fullName} — {customer.email}</option>)}</select></div>}
    <div className="space-y-2"><Label htmlFor="vehicleNumber">Vehicle number</Label><Input id="vehicleNumber" name="vehicleNumber" autoCapitalize="characters" required /></div>
    <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="fuel-type">Fuel type</Label><select id="fuel-type" className="native-select" value={fuelType} onChange={event => setFuelType(event.target.value)}><option value="PETROL">Petrol</option><option value="DIESEL">Diesel</option></select></div>
      <div className="space-y-2"><Label htmlFor="order-mode">Order by</Label><select id="order-mode" className="native-select" value={mode} onChange={event => { setMode(event.target.value); setAmount(""); }}><option value="quantity">Quantity in litres</option><option value="amount">Amount in rupees</option></select></div></div>
    <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="requested">{mode === "quantity" ? "Quantity (L)" : "Fuel amount (₹)"}</Label><Input id="requested" type="number" inputMode="decimal" step={mode === "quantity" ? "0.001" : "0.01"} min={mode === "quantity" ? "0.001" : "0.01"} value={amount} onChange={event => setAmount(event.target.value)} required /></div>
      <div className="space-y-2"><Label htmlFor="order-cash">Extra cash (₹)</Label><Input id="order-cash" type="number" inputMode="numeric" min="0" step="1" value={cash} onChange={event => setCash(event.target.value)} required /></div></div>
    <p className="text-sm text-slate-600">An indent is assigned from the customer’s configured range. The final charge uses the quantity actually delivered and the price at delivery.</p>
    {amount && estimate !== null && <p className="font-medium">Estimated total: {money(estimate)}</p>}
    <Button type="submit" className="w-full" disabled={busy}>{busy ? "Placing order…" : "Place order"}</Button>
  </form>;
}
