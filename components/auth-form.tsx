"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function AuthForm({ register = false }: { register?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setSuccess("");
    const values = new FormData(event.currentTarget);
    try {
      const response = await fetch(register ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          email: values.get("email"), password: values.get("password"),
          ...(register && { fullName: values.get("fullName"), phone: values.get("phone") || undefined, role: "CUSTOMER" }),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not sign in");
      if (register) { setSuccess("Account created. Sign in to start ordering."); }
      else { router.push("/dashboard"); router.refresh(); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Please try again"); }
    finally { setBusy(false); }
  }
  return <main className="flex min-h-dvh items-center justify-center bg-slate-50 p-4 sm:p-8">
    <section className="w-full max-w-md rounded-xl bg-white p-6 shadow-md sm:p-8" aria-labelledby="auth-title">
      <h1 id="auth-title" className="text-2xl font-semibold text-slate-900">{register ? "Create a customer account" : "Sign in"}</h1>
      <p className="mt-2 text-slate-600">Petrol Pump Management System</p>
      <form method="post" onSubmit={submit} className="mt-8 space-y-5">
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
        {success && <p role="status" className="rounded-lg bg-green-50 p-3 text-green-800">{success}</p>}
        {register && <div className="space-y-2"><Label htmlFor="fullName">Full name</Label><Input id="fullName" name="fullName" autoComplete="name" required minLength={2} /></div>}
        <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" autoComplete="username" required /></div>
        <div className="space-y-2"><Label htmlFor="password">Password</Label><Input id="password" name="password" type="password" autoComplete={register ? "new-password" : "current-password"} required minLength={register ? 8 : undefined} />
          {register && <p className="text-sm text-slate-600">Use at least 8 characters.</p>}</div>
        {register && <div className="space-y-2"><Label htmlFor="phone">Phone (optional)</Label><Input id="phone" name="phone" type="tel" inputMode="numeric" autoComplete="tel-national" pattern="[0-9]{10}" maxLength={10} /></div>}
        <Button type="submit" disabled={busy} className="w-full">{busy ? "Please wait…" : register ? "Create account" : "Sign in"}</Button>
      </form>
      <p className="mt-6 text-sm text-slate-600">{register ? "Already have an account? " : "New customer? "}
        <Link className="inline-flex min-h-11 min-w-11 items-center font-medium text-blue-700 underline underline-offset-4" href={register ? "/login" : "/signup"}>{register ? "Sign in" : "Create an account"}</Link></p>
    </section>
  </main>;
}
