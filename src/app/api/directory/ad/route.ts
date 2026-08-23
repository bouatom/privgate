import { NextResponse } from "next/server";
import { getAdSettings, getDb, saveAdSettings } from "@/lib/db";
import { isResponse, requireAdmin, requireAny } from "@/lib/http";
import { probeHost } from "@/lib/smtp";
import { auditConfigChange, auditConfigAccess } from "@/lib/audit-helpers";

export async function GET() {
  const auth = await requireAny(["integrations.view", "integrations.manage"]);
  if (isResponse(auth)) return auth;
  return NextResponse.json(getAdSettings(getDb()));
}

export async function PUT(req: Request) {
  const auth = await requireAdmin("integrations.manage");
  if (isResponse(auth)) return auth;
  const body = (await req.json()) as Record<string, unknown>;
  const db = getDb();
  const oldSettings = getAdSettings(db);
  const newSettings = {
    host: String(body.host || "").trim(),
    port: Number(body.port || 636),
    useTls: body.useTls !== false,
    bindDn: String(body.bindDn || "").trim(),
    baseDn: String(body.baseDn || "").trim(),
    userFilter: String(body.userFilter || ""),
    password: body.password ? String(body.password) : undefined,
  };
  saveAdSettings(db, newSettings, auth.session.email);
  
  // Audit configuration change with diff
  auditConfigChange(db, auth.session.email, "ad", "directory", oldSettings, newSettings);
  
  return NextResponse.json(getAdSettings(getDb()));
}

export async function POST() {
  const auth = await requireAdmin("integrations.manage");
  if (isResponse(auth)) return auth;
  const db = getDb();
  const settings = getAdSettings(db);
  if (!settings.host) {
    return NextResponse.json({ error: "Save a domain controller host first." }, { status: 400 });
  }
  try {
    await probeHost(settings.host, settings.port, settings.useTls);
    saveAdSettings(db, { lastTestedAt: new Date().toISOString(), lastError: "" }, auth.session.email);
    
    // Audit successful connection test
    auditConfigAccess(db, auth.session.email, "ad.test", settings.host, { ok: true });
    
    return NextResponse.json({ ok: true, ...getAdSettings(db) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection failed";
    saveAdSettings(db, { lastTestedAt: new Date().toISOString(), lastError: message }, auth.session.email);
    
    // Audit failed connection test
    auditConfigAccess(db, auth.session.email, "ad.test", settings.host, { ok: false, error: message });
    
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
