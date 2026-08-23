import { NextResponse } from "next/server";
import { syncAdUsers } from "@/lib/ad-ldap";
import { auditConfigAccess } from "@/lib/audit-helpers";
import { getAdSettings, getDb, saveAdSettings } from "@/lib/db";
import { isResponse, requireAdmin } from "@/lib/http";

export async function POST() {
  const auth = await requireAdmin("integrations.manage");
  if (isResponse(auth)) return auth;
  const db = getDb();
  const settings = getAdSettings(db);
  try {
    const result = await syncAdUsers(db);
    auditConfigAccess(db, auth.session.email, "ad.sync", settings.host, { ok: true, users: result.users });
    return NextResponse.json({ ok: true, ...result, ...getAdSettings(db) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AD sync failed";
    saveAdSettings(db, { lastError: message }, auth.session.email);
    auditConfigAccess(db, auth.session.email, "ad.sync", settings.host, { ok: false, error: message });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
