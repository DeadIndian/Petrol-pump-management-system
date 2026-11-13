import { NextRequest, NextResponse } from "next/server";
import { requestUser, hasPermission } from "@/lib/bunkbook/auth";
import { jsonFields, modules, resolveModule } from "@/lib/bunkbook/catalog";
import { renderBunkBook, viewHeaders } from "@/lib/bunkbook/render";
import { rolePages } from "@/lib/bunkbook/permissions";
import { supplementaryParents } from "@/lib/bunkbook/supplementary";
import { safeFields } from "@/lib/bunkbook/rules";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const route = path.join("/");
  try {
    const actor = await requestUser(request);
    if (["station", "Reffcode", "reffcode", "login/switch_bunk"].includes(route)) return NextResponse.redirect(new URL("/bunkbook/login", request.url));
    if (["login", "login/reset_pwd"].includes(route)) {
      if (actor) return NextResponse.redirect(new URL("/api/bunkbook/view/Dashboard", request.url));
      return new Response(await renderBunkBook("login", { screen: "login", station: "BunkBook", reset: route === "login/reset_pwd" }, "BunkBook"), { headers: viewHeaders });
    }
    if (!actor) return NextResponse.redirect(new URL("/api/bunkbook/view/login", request.url));
    const moduleSchema = resolveModule(route);
    if (!moduleSchema) return new Response("BunkBook page not found.", { status: 404 });
    if (!hasPermission(actor, moduleSchema.id)) return new Response("Your role does not have permission to open this module.", { status: 403 });
    const context = {
      screen: "application", module: moduleSchema,
      modules: modules.filter(item => hasPermission(actor, item.id)).map(({ id, path, title, kind }) => ({ id, path, title, kind })),
      actor: { id: actor.id, username: actor.username, fullName: actor.fullName, role: actor.role, permissions: actor.permissions, lastLoginAt: actor.lastLoginAt },
      station: actor.station.name,
      settings: safeFields(jsonFields(actor.station.settings)), rolePages, parents: supplementaryParents, query: Object.fromEntries(request.nextUrl.searchParams),
    };
    return new Response(await renderBunkBook(moduleSchema.id, context, actor.station.name), { headers: viewHeaders });
  } catch {
    // The login layout is available before a local station is initialized.
    if (["login", "login/reset_pwd"].includes(route)) return new Response(await renderBunkBook("login", { screen: "login", station: "BunkBook" }, "BunkBook"), { headers: viewHeaders });
    return new Response("The BunkBook database is unavailable. Start the local service and reload this page.", { status: 503 });
  }
}
