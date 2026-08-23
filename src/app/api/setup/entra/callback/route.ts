import { NextResponse } from "next/server";
import { getDb, appendAudit } from "@/lib/db";
import { requestOrigin } from "@/lib/origin";
import { completePkceCallback } from "@/lib/entra";
import { getSession } from "@/lib/auth";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const origin = requestOrigin(req);
  const db = getDb();
  const dest = "/configuration/integrations";
  const session = await getSession();

  if (!code || !state) {
    if (session?.email) {
      appendAudit(db, session.email, "config.entra.callback.error", "entra", { reason: "missing-code" });
    }
    return NextResponse.redirect(new URL(`${dest}?entra=error&reason=missing-code`, origin));
  }

  try {
    await completePkceCallback(db, code, state, origin, "entra-setup");
    if (session?.email) {
      appendAudit(db, session.email, "config.entra.setup.complete", "entra", { via: "pkce" });
    }
    return NextResponse.redirect(new URL(`${dest}?entra=connected`, origin));
  } catch (error) {
    const reason = encodeURIComponent(error instanceof Error ? error.message : "setup-failed");
    if (session?.email) {
      appendAudit(db, session.email, "config.entra.callback.error", "entra", { reason });
    }
    return NextResponse.redirect(new URL(`${dest}?entra=error&reason=${reason}`, origin));
  }
}
