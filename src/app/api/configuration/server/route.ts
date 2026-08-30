import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { appendAudit } from "@/lib/db/audit";
import { isResponse, requireAdmin } from "@/lib/http";
import { lanUrls, listenConfig } from "@/lib/listen";
import { currentServerApplyStatus } from "@/lib/server-settings-state";
import { describeServerTarget } from "@/lib/server-settings";

export const dynamic = "force-dynamic";

/**
 * GET  → current listen configuration + on-disk server-settings apply state.
 * Readable by any signed-in admin; mutating actions are gated separately.
 *
 * Mirrors the update status route: emits a terminal audit event when the apply
 * log shows success. Idempotent — the route may be polled many times, but the
 * audit row is keyed by target so duplicates are harmless.
 */
async function statusBody() {
  const apply = currentServerApplyStatus();
  if (apply.phase === "succeeded" && apply.target) {
    appendAudit(getDb(), "system:server-settings-complete", "console.server.apply.succeeded", describeServerTarget(apply.target), {});
  }
  const current = listenConfig();
  return NextResponse.json({
    current,
    apply,
    lanUrls: lanUrls(current.webPort, current.bind),
    platform: process.platform,
    arch: process.arch,
  });
}

export async function GET() {
  const auth = await requireAdmin();
  if (isResponse(auth)) return auth;
  return statusBody();
}