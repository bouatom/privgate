import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requestOrigin } from "@/lib/origin";
import { completePkceCallback } from "@/lib/entra";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const origin = requestOrigin(req);
  if (!code || !state) {
    return NextResponse.redirect(new URL("/configuration/integrations?entra=error&reason=missing-code", origin));
  }
  try {
    await completePkceCallback(getDb(), code, state, origin, "entra-setup");
    return NextResponse.redirect(new URL("/configuration/integrations?entra=connected", origin));
  } catch (error) {
    const reason = encodeURIComponent(error instanceof Error ? error.message : "setup-failed");
    return NextResponse.redirect(new URL(`/configuration/integrations?entra=error&reason=${reason}`, origin));
  }
}
