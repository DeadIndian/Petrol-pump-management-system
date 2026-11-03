"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { money } from "@/lib/web-types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
interface Employee { id: string; fullName: string; email: string; activity: { completedOrders: number; deliveredLiters: number; totalValue: number; lastDeliveryAt: string | null }; }
export default function EmployeeActivitySection() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const load = useCallback((signal?: AbortSignal) => api.get<{ users: Employee[]; pagination: { total: number } }>(`/api/admin/users?role=EMPLOYEE&limit=20&offset=${offset}&search=${encodeURIComponent(search)}`, { signal })
    .then(data => { if (!signal?.aborted) { setEmployees(data.users); setTotal(data.pagination.total); setError(""); } })
    .catch(cause => { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Could not load employees"); }), [search, offset]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  return <section className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Employee deliveries</h2><Button variant="outline" onClick={() => void load()}>Refresh employees</Button></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    <div className="space-y-2"><Label htmlFor="employee-search">Search employees</Label><Input id="employee-search" value={search} onChange={event => { setSearch(event.target.value); setOffset(0); }} /></div>
    <Card><CardHeader><CardTitle className="text-base">Delivery activity</CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Completed deliveries</TableHead><TableHead>Litres delivered</TableHead><TableHead>Delivery value</TableHead><TableHead>Last delivery</TableHead></TableRow></TableHeader><TableBody>{employees.map(employee => <TableRow key={employee.id}><TableCell><p className="font-medium">{employee.fullName}</p><p className="text-sm text-slate-600">{employee.email}</p></TableCell><TableCell>{employee.activity.completedOrders}</TableCell><TableCell>{employee.activity.deliveredLiters.toLocaleString("en-IN")} L</TableCell><TableCell>{money(employee.activity.totalValue)}</TableCell><TableCell>{employee.activity.lastDeliveryAt ? new Date(employee.activity.lastDeliveryAt).toLocaleString("en-IN") : "No deliveries yet"}</TableCell></TableRow>)}</TableBody></Table>{employees.length === 0 && <p className="py-4 text-slate-600">No employees match your search.</p>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-600">{total} employees</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={offset === 0} onClick={() => setOffset(offset - 20)}>Previous</Button><Button variant="outline" disabled={offset + 20 >= total} onClick={() => setOffset(offset + 20)}>Next</Button></div></div></CardContent></Card>
  </section>;
}
