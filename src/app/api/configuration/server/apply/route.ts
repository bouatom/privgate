import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { appendAudit } from "@/lib/db/audit";
import { isResponse, requireAdmin } from "@/lib/http";
import { listenConfig } from "@/lib/listen";
import { applyServerSettings } from "@/lib/server-settings-apply";
import { abandonServerApplyLock } from "@/lib/server-settings-state";
import { parseServerTarget, serverTargetEquals } from "@/lib/server-settings";

export const dynamic = "force-dynamic";

/**
 * Change where the console listens (bind + web port + broker port).
 *
 * The new target is validated, written as a pending apply, then handed off to
 * the platform restart script (Windows: SYSTEM scheduled task; Unix: detached
 * child). That script backs up console.env, writes the new values (never
 * touching secrets), restarts the service, health-checks on the NEW port and
 * rolls back automatically if the console does not come up. This route answers
 * 202 before the restart kills the process — poll GET /api/configuration/server
 * for the apply verdict.
 *
 * Only Master Admins (portal.users.manage) can change server networking.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin("portal.users.manage");
  if (isResponse(auth)) return auth;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = parseServerTarget(body ?? {});
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const current = listenConfig();
  if (serverTargetEquals(parsed.target, current)) {
    return NextResponse.json({ error: "These settings are already in effect." }, { status: 409 });
  }

  const result = await applyServerSettings({
    db: getDb(),
    actor: auth.session.email,
    target: parsed.target,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ started: true, target: result.target }, { status: 202 });
}

/** Clear a stuck server-settings apply (updater never started). */
export async function DELETE() {
  const auth = await requireAdmin("portal.users.manage");
  if (isResponse(auth)) return auth;
  const result = abandonServerApplyLock();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  appendAudit(getDb(), auth.session.email, "console.server.apply.abandoned", "(lock)", {});
  return NextResponse.json({ abandoned: true });
}