import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { appendAudit } from "@/lib/db/audit";
import { isResponse, requireAdmin } from "@/lib/http";
import { getUpdateChannel, setUpdateChannel } from "@/lib/setup-state";
import { checkForUpdate } from "@/lib/self-update-service";
import { normalizeChannel } from "@/lib/self-update";

export const dynamic = "force-dynamic";

/** Persist the release channel. Gated + audited; re-checks immediately so the badge reflects the new channel. */
export async function PUT(req: Request) {
  const auth = await requireAdmin("configuration.update");
  if (isResponse(auth)) return auth;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!body || (body.channel !== "official" && body.channel !== "nightly")) {
    return NextResponse.json({ error: "channel must be \"official\" or \"nightly\"" }, { status: 400 });
  }
  const channel = normalizeChannel(body.channel);
  const db = getDb();
  const previous = getUpdateChannel(db);
  setUpdateChannel(db, channel);
  appendAudit(db, auth.session.email, "console.update.channel", channel, { from: previous });
  // Channel changed the upgrade path — refresh the cached verdict right away.
  await checkForUpdate({ db });
  return NextResponse.json({ ok: true, channel: getUpdateChannel(db) });
}
