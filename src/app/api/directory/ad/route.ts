import { NextResponse } from "next/server";
import { getAdSettings, getDb, saveAdSettings, appendAudit } from "@/lib/db";
import { isResponse, requireAdmin } from "@/lib/http";
import { probeHost } from "@/lib/smtp";

export async function GET() {
  const auth = await requireAdmin();
  if (isResponse(auth)) return auth;
  return NextResponse.json(getAdSettings(getDb()));
}

export async function PUT(req: Request) {
  const auth = await requireAdmin("PolicyAdmin");
  if (isResponse(auth)) return auth;
  const body = (await req.json()) as Record<string, unknown>;
  const db = getDb();
  saveAdSettings(
    db,
    {
      host: String(body.host || "").trim(),
      port: Number(body.port || 636),
      useTls: body.useTls !== false,
      bindDn: String(body.bindDn || "").trim(),
      baseDn: String(body.baseDn || "").trim(),
      userFilter: String(body.userFilter || ""),
      password: body.password ? String(body.password) : undefined,
    },
    auth.session.email,
  );
  appendAudit(db, auth.session.email, "ad.save", "directory", { host: String(body.host || "") });
  return NextResponse.json(getAdSettings(getDb()));
}

export async function POST() {
  const auth = await requireAdmin("PolicyAdmin");
  if (isResponse(auth)) return auth;
  const db = getDb();
  const settings = getAdSettings(db);
  if (!settings.host) {
    return NextResponse.json({ error: "Save a domain controller host first." }, { status: 400 });
  }
  try {
    await probeHost(settings.host, settings.port, settings.useTls);
    saveAdSettings(db, { lastTestedAt: new Date().toISOString(), lastError: "" }, auth.session.email);
    appendAudit(db, auth.session.email, "ad.test", settings.host, { ok: true });
    return NextResponse.json({ ok: true, ...getAdSettings(db) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection failed";
    saveAdSettings(db, { lastTestedAt: new Date().toISOString(), lastError: message }, auth.session.email);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
