import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
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
async function statusBody(forceCheck: boolean) {
  if (forceCheck) await checkForUpdate({ db: getDb() });
  return NextResponse.json({
    installed: installedConsoleVersionInfo(),
    channel: getUpdateChannel(getDb()),
    check: cachedCheck(),
    apply: currentApplyStatus(),
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
  return statusBody(true);
}
