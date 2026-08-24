import { NextResponse } from "next/server";
import { currentClientVersion } from "@/lib/client-version";
import { getDb } from "@/lib/db";
import { connectedDeviceIds } from "@/lib/realtime/bus";

/**
 * Liveness probe for updaters and orchestrators (packaging/health-check.cjs).
 * Deliberately unauthenticated and secret-free: it answers whether the HTTP
 * stack is serving and the database opens — nothing else.
 */
export async function GET() {
  let db = false;
  try {
    getDb().prepare("SELECT 1").get();
    db = true;
  } catch {
    db = false;
  }
  const body = {
    ok: db,
    db,
    agentsOnline: connectedDeviceIds().length,
    version: currentClientVersion(),
  };
  return NextResponse.json(body, { status: db ? 200 : 503 });
}
