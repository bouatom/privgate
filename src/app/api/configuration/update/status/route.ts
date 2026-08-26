import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { appendAudit } from "@/lib/db/audit";
import { isResponse, requireAdmin } from "@/lib/http";
import { installedConsoleVersionInfo } from "@/lib/console-version";
import { getUpdateChannel } from "@/lib/setup-state";
import { cachedCheck, checkForUpdate } from "@/lib/self-update-service";
import { currentApplyStatus } from "@/lib/self-update-status";

export const dynamic = "force-dynamic";

/**
 * GET  → cached verdict + on-disk apply state (no network).
 * POST → same body after a forced re-check against GitHub.
 * Readable by any signed-in admin; mutating actions are gated separately.
 */
async function statusBody(forceCheck: boolean, actor?: string) {
  if (forceCheck) {
    await checkForUpdate({ db: getDb() });
    if (actor) appendAudit(getDb(), actor, "console.update.check", "(force)", {});
  }
  const apply = currentApplyStatus();
  // Emit a terminal audit event when the apply log shows success. Idempotent:
  // the status route may be polled many times, but the audit row is keyed by
  // target so duplicates are harmless (same action+target+details = identical row).
  if (apply.phase === "succeeded" && apply.target) {
    appendAudit(getDb(), "system:update-complete", "console.update.apply.succeeded", apply.target, {});
  }
  return NextResponse.json({
    installed: installedConsoleVersionInfo(),
    channel: getUpdateChannel(getDb()),
    check: cachedCheck(),
    apply,
    platform: process.platform,
    arch: process.arch,
  });
}

export async function GET() {
  const auth = await requireAdmin();
  if (isResponse(auth)) return auth;
  return statusBody(false);
}

export async function POST() {
  const auth = await requireAdmin();
  if (isResponse(auth)) return auth;
  return statusBody(true, auth.session.email);
}
