import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { appendAudit } from "@/lib/db/audit";
import { isResponse, requireAdmin } from "@/lib/http";
import { checkForUpdate } from "@/lib/self-update-service";
import { applyConsoleUpdate } from "@/lib/self-update-apply";
import { abandonApplyLock } from "@/lib/self-update-status";
import { platformKey } from "@/lib/self-update";

export const dynamic = "force-dynamic";

/**
 * One-click update. Re-checks GitHub to pin the target, downloads + verifies
 * the artifact (fail closed), then hands off to the platform updater (Windows:
 * SYSTEM scheduled task so stopping the console cannot kill it; Unix:
 * detached child) and answers 202 before the updater kills this process.
 *
 * Platform note: the updater needs privileges to stop/start the service.
 * Windows (WinSW LocalSystem) and macOS (launchd root daemon) have them; the
 * Linux systemd unit is sandboxed to the unprivileged `privgate` user on
 * purpose, so there the apply reports an error instead of pretending.
 */
const APPLY_BLOCKED_ON_LINUX =
  "This Linux install runs under a sandboxed service account that cannot stop the system service or run dpkg. Update with `sudo /opt/privgate/update-server.sh --deb <file>` instead.";

export async function POST() {
  const auth = await requireAdmin("configuration.update");
  if (isResponse(auth)) return auth;

  if (platformKey() === "linux") {
    return NextResponse.json({ error: APPLY_BLOCKED_ON_LINUX }, { status: 409 });
  }

  const db = getDb();
  const check = await checkForUpdate({ db });
  if (!check.available || !check.version || !check.url || !check.sumsUrl) {
    appendAudit(db, auth.session.email, "console.update.apply.attempted", "(no-version)", {
      reason: check.error ?? "no update available",
    });
    return NextResponse.json(
      { error: check.error ? `No update can be verified right now: ${check.error}` : "No newer version available for this channel." },
      { status: check.version && !check.available ? 409 : 502 },
    );
  }

  const result = await applyConsoleUpdate({
    db,
    actor: auth.session.email,
    candidate: {
      version: check.version,
      channel: check.channel,
      assetName: check.assetName ?? "",
      url: check.url,
      sumsUrl: check.sumsUrl,
      releaseUrl: check.releaseUrl,
      prerelease: check.prerelease,
    },
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ started: true, target: result.target }, { status: 202 });
}

/** Clear a stuck apply lock (updater never started) so Update can be clicked again. */
export async function DELETE() {
  const auth = await requireAdmin("configuration.update");
  if (isResponse(auth)) return auth;
  const result = abandonApplyLock();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  appendAudit(getDb(), auth.session.email, "console.update.apply.abandoned", "(lock)", {});
  return NextResponse.json({ abandoned: true });
}
