"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { WebUser } from "@/lib/web-types";
import { money } from "@/lib/web-types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";

interface Profile { currentBalance: number; totalOrders: number; totalPurchases: number; totalPayments: number; currentIndent: number | null; indentEnd: number | null; }
interface Payment { id: string; amount: number; paymentMethod: string | null; paymentMethodNote: string | null; reference: string | null; paymentDate: string; }
interface Account { user: WebUser & { customerProfile: Profile | null }; activity: { completedOrders: number; deliveredLiters: number; totalValue: number }; }

export default function AccountSection() {
  const [account, setAccount] = useState<Account | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback((signal?: AbortSignal) => api.get<Account>("/api/account", { signal })
    .then(async data => {
      const history = data.user.role === "CUSTOMER" ? await api.get<{ payments: Payment[]; pagination: { total: number } }>(`/api/bills?limit=20&offset=${offset}`, { signal }) : null;
      if (signal?.aborted) return;
      setAccount(data); setError("");
      if (history) { setPayments(history.payments); setTotal(history.pagination.total); }
    })
    .catch(cause => { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Could not load your account"); })
    .finally(() => { if (!signal?.aborted) setLoading(false); }), [offset]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const profile = account?.user.role === "CUSTOMER" ? account.user.customerProfile : null;
  return <section className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">My account</h2><Button variant="outline" onClick={() => { setLoading(true); void load(); }} disabled={loading}>Refresh account</Button></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    {!account ? <p role="status">Loading your account…</p> : <><dl className="detail-list rounded-xl bg-white p-5"><div><dt>Name</dt><dd>{account.user.fullName}</dd></div><div><dt>Email</dt><dd>{account.user.email}</dd></div><div><dt>Phone</dt><dd>{account.user.phone || "Not provided"}</dd></div><div><dt>Role</dt><dd>{account.user.role}</dd></div></dl>
      {profile ? <><div className="grid gap-4 sm:grid-cols-2"><Card><CardHeader><CardTitle className="text-base">{profile.currentBalance < 0 ? "Amount due" : "Available credit"}</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold" data-testid="customer-balance">{money(Math.abs(profile.currentBalance))}</p></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Next indent</CardTitle></CardHeader><CardContent><p className="text-xl font-semibold">{profile.currentIndent == null ? "Not configured" : profile.indentEnd != null && profile.currentIndent > profile.indentEnd ? "Range exhausted" : profile.currentIndent}</p><p className="mt-2 text-sm text-slate-600">{profile.currentIndent == null || (profile.indentEnd != null && profile.currentIndent > profile.indentEnd) ? "Ask an administrator to configure a new range before ordering." : `Available through ${profile.indentEnd}.`}</p></CardContent></Card></div>
        <dl className="detail-list rounded-xl bg-white p-5"><div><dt>Completed orders</dt><dd>{profile.totalOrders}</dd></div><div><dt>Total purchases</dt><dd>{money(profile.totalPurchases)}</dd></div><div><dt>Total payments</dt><dd>{money(profile.totalPayments)}</dd></div></dl>
        <Card><CardHeader><CardTitle>Payment history</CardTitle><p className="text-sm text-slate-600">Payments recorded by the petrol pump appear here.</p></CardHeader><CardContent>{payments.length ? <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Amount</TableHead><TableHead>Method</TableHead><TableHead>Reference</TableHead></TableRow></TableHeader><TableBody>{payments.map(payment => <TableRow key={payment.id}><TableCell>{new Date(payment.paymentDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</TableCell><TableCell>{money(payment.amount)}</TableCell><TableCell>{payment.paymentMethod?.replace(/_/g, " ") || "Not specified"}{payment.paymentMethodNote && <p>{payment.paymentMethodNote}</p>}</TableCell><TableCell>{payment.reference || "—"}</TableCell></TableRow>)}</TableBody></Table> : <p className="py-4 text-slate-600">No payments have been recorded yet.</p>}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-600">{total} payments</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={offset === 0 || loading} onClick={() => { setLoading(true); setOffset(offset - 20); }}>Previous payments</Button><Button variant="outline" disabled={offset + 20 >= total || loading} onClick={() => { setLoading(true); setOffset(offset + 20); }}>Next payments</Button></div></div></CardContent></Card>
      </> : <Card><CardHeader><CardTitle>My deliveries</CardTitle></CardHeader><CardContent><dl className="detail-list"><div><dt>Completed deliveries</dt><dd>{account.activity.completedOrders}</dd></div><div><dt>Fuel delivered</dt><dd>{account.activity.deliveredLiters.toLocaleString("en-IN")} L</dd></div><div><dt>Total delivery value</dt><dd>{money(account.activity.totalValue)}</dd></div></dl></CardContent></Card>}
    </>}
  </section>;
}
