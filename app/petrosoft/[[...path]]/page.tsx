/* Hallmark · pre-emit critique: P5 H4 E4 S5 R5 V4 · source-pinned Petrosoft interface */
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Petrosoft", description: "Petrol bunk management software" };

export default async function PetrosoftPage({ params, searchParams }: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { path = [] } = await params;
  const query = await searchParams;
  const url = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (typeof value === "string") url.set(key, value);
  const source = `/api/petrosoft/view/${path.map(encodeURIComponent).join("/") || "station"}${url.size ? `?${url}` : ""}`;
  return <iframe title="Petrosoft management software" src={source} style={{
    position: "fixed", inset: 0, width: "100%", height: "100dvh", border: 0,
    background: "white", display: "block",
  }} />;
}
