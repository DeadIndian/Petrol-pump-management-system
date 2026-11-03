import { NextRequest, NextResponse } from "next/server";
import { requestUser, hasPermission, STATION_COOKIE } from "@/lib/petrosoft/auth";
import { jsonFields, modules, resolveModule } from "@/lib/petrosoft/catalog";
import { petrosoftDb } from "@/lib/petrosoft/db";
import { renderPetrosoft, viewHeaders } from "@/lib/petrosoft/render";
import { rolePages } from "@/lib/petrosoft/permissions";
import { supplementaryParents } from "@/lib/petrosoft/supplementary";
import { safeFields } from "@/lib/petrosoft/rules";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const route = path.join("/");
  try {
    const actor = await requestUser(request);
    if (["station", "Reffcode", "reffcode", "login", "login/reset_pwd", "login/switch_bunk"].includes(route)) {
      if (actor && route !== "login/switch_bunk") return NextResponse.redirect(new URL("/api/petrosoft/view/Dashboard", request.url));
      const workspaceId = request.cookies.get(STATION_COOKIE)?.value;
      const workspace = workspaceId ? await petrosoftDb.petrosoftWorkspace.findUnique({ where: { id: workspaceId } }) : null;
      const template = route === "login" && workspace ? "login" : "station";
      const context = { screen: template, station: workspace?.name || "Petrosoft", reset: route === "login/reset_pwd" };
      return new Response(await renderPetrosoft(template, context, workspace?.name || "Petrosoft"), { headers: viewHeaders });
    }
    if (!actor) return NextResponse.redirect(new URL("/api/petrosoft/view/login", request.url));
    const moduleSchema = resolveModule(route);
    if (!moduleSchema) return new Response("Petrosoft page not found.", { status: 404 });
    if (!hasPermission(actor, moduleSchema.id)) return new Response("Your role does not have permission to open this module.", { status: 403 });
    const context = {
      screen: "application", module: moduleSchema,
      modules: modules.filter(item => hasPermission(actor, item.id)).map(({ id, path, title, kind }) => ({ id, path, title, kind })),
      actor: { id: actor.id, username: actor.username, fullName: actor.fullName, role: actor.role, permissions: actor.permissions, lastLoginAt: actor.lastLoginAt },
      station: actor.workspace.name, referenceCode: actor.workspace.referenceCode,
      settings: safeFields(jsonFields(actor.workspace.settings)), rolePages, parents: supplementaryParents, query: Object.fromEntries(request.nextUrl.searchParams),
    };
    return new Response(await renderPetrosoft(moduleSchema.id, context, actor.workspace.name, actor.workspace.referenceCode), { headers: viewHeaders });
  } catch {
    // The reference-code layout is available before a local station is initialized.
    if (["station", "login"].includes(route)) return new Response(await renderPetrosoft("station", { screen: "station", station: "Petrosoft" }, "Petrosoft"), { headers: viewHeaders });
    return new Response("The Petrosoft database is unavailable. Start the local service and reload this page.", { status: 503 });
  }
}
