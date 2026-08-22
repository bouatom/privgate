import { NextResponse } from "next/server";
import { getDb, getNotificationSettings, saveNotificationSettings } from "@/lib/db";
import { isResponse, requireAdmin, requireAny } from "@/lib/http";
import { dispatchNotification } from "@/lib/notify";

export async function GET() {
  const auth = await requireAny(["notifications.view", "notifications.manage"]);
  if (isResponse(auth)) return auth;
  return NextResponse.json(getNotificationSettings(getDb()));
}

export async function PUT(req: Request) {
  const auth = await requireAdmin("notifications.manage");
  if (isResponse(auth)) return auth;
  const body = (await req.json()) as Record<string, unknown>;
  saveNotificationSettings(getDb(), {
    emailEnabled: Boolean(body.emailEnabled),
    smtpHost: String(body.smtpHost || ""),
    smtpPort: Number(body.smtpPort || 587),
    smtpSecure: Boolean(body.smtpSecure),
    smtpUser: String(body.smtpUser || ""),
    smtpFrom: String(body.smtpFrom || ""),
    recipients: String(body.recipients || ""),
    smtpPass: body.smtpPass ? String(body.smtpPass) : undefined,
    webhookEnabled: Boolean(body.webhookEnabled),
    webhookUrl: String(body.webhookUrl || ""),
    onPending: Boolean(body.onPending),
    onApproved: Boolean(body.onApproved),
    onDenied: Boolean(body.onDenied),
    onJit: Boolean(body.onJit),
    criticalOnly: Boolean(body.criticalOnly),
  });
  return NextResponse.json(getNotificationSettings(getDb()));
}

export async function POST() {
  const auth = await requireAdmin("notifications.manage");
  if (isResponse(auth)) return auth;
  try {
    const result = await dispatchNotification(getDb(), {
      kind: "pending",
      riskLevel: "critical",
      title: "[PrivGate] Test notification",
      body: "If you received this, request and approval alerts are configured.",
    });
    if (!result.sent) {
      return NextResponse.json(
        { error: "Enable email or a webhook, save, then send a test." },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Notification test failed" },
      { status: 400 },
    );
  }
}
