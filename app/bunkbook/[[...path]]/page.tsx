/* Hallmark · pre-emit critique: P5 H4 E4 S5 R5 V4 · source-pinned BunkBook interface */
import type { Metadata } from "next";

export const metadata: Metadata = { title: "BunkBook", description: "Petrol bunk management software" };

export default async function BunkBookPage({ params, searchParams }: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { path = [] } = await params;
  const query = await searchParams;
  const url = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (typeof value === "string") url.set(key, value);
  const source = `/api/bunkbook/view/${path.map(encodeURIComponent).join("/") || "login"}${url.size ? `?${url}` : ""}`;
  return <iframe title="BunkBook management software" src={source} style={{
    position: "fixed", inset: 0, width: "100%", height: "100dvh", border: 0,
    background: "white", display: "block",
  }} />;
}
