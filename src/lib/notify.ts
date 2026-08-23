import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { getNotificationSecrets, getNotificationSettings, getUser, getDevice } from "./db";
import { sendSmtp } from "./smtp";

export type NotifyEvent = {
  kind: "pending" | "approved" | "denied" | "jit";
  title: string;
  body: string;
  riskLevel?: string;
};

export function shouldNotify(
  settings: ReturnType<typeof getNotificationSettings>,
  event: NotifyEvent,
): boolean {
  if (settings.criticalOnly && event.riskLevel && event.riskLevel !== "high" && event.riskLevel !== "critical") {
    if (event.kind === "pending") return false;
  }
  if (event.kind === "pending" && !settings.onPending) return false;
  if (event.kind === "approved" && !settings.onApproved) return false;
  if (event.kind === "denied" && !settings.onDenied) return false;
  if (event.kind === "jit" && !settings.onJit) return false;
  return settings.emailEnabled || settings.webhookEnabled;
}

export function parseRecipients(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes("@"));
}

export async function dispatchNotification(db: DatabaseSync, event: NotifyEvent) {
  const settings = getNotificationSettings(db);
  if (!shouldNotify(settings, event)) return { sent: false as const, reason: "disabled" };
  const errors: string[] = [];

  if (settings.webhookEnabled && settings.webhookUrl) {
    try {
      const res = await fetch(settings.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: `${event.title}\n${event.body}`,
          event: event.kind,
          riskLevel: event.riskLevel,
        }),
      });
      if (!res.ok) errors.push(`webhook ${res.status}`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "webhook failed");
    }
  }

  if (settings.emailEnabled) {
    const to = parseRecipients(settings.recipients);
    if (!settings.smtpHost || !to.length) {
      errors.push("email is on but SMTP host or recipients are missing");
    } else {
      try {
        const secrets = getNotificationSecrets(db);
        await sendSmtp({
          host: settings.smtpHost,
          port: settings.smtpPort,
          secure: settings.smtpSecure,
          user: settings.smtpUser || undefined,
          pass: secrets.smtpPass || undefined,
          from: settings.smtpFrom || settings.smtpUser || to[0]!,
          to,
          subject: event.title,
          text: event.body,
        });
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "smtp failed");
      }
    }
  }

  if (errors.length) throw new Error(errors.join("; "));
  return { sent: true as const };
}

export function requestNotifyEvent(
  kind: "pending" | "approved" | "denied",
  req: {
    filePath: string;
    riskLevel?: string;
    userId?: string;
    deviceId?: string;
  },
  db: DatabaseSync,
): NotifyEvent {
  const user = req.userId ? getUser(db, req.userId) : undefined;
  const device = req.deviceId ? getDevice(db, req.deviceId) : undefined;
  const verb = kind === "pending" ? "needs approval" : kind === "approved" ? "was approved" : "was denied";
  return {
    kind,
    riskLevel: req.riskLevel,
    title: `[PrivGate] Elevation ${verb}: ${req.filePath.split(/\\|\//).pop() || req.filePath}`,
    body: [
      `Program: ${req.filePath}`,
      `User: ${user?.userPrincipalName || req.userId || "unknown"}`,
      `Device: ${device?.hostname || req.deviceId || "unknown"}`,
      `Risk: ${req.riskLevel || "n/a"}`,
      `Status: ${kind}`,
    ].join("\n"),
  };
}

export function queueNotification(db: DatabaseSync, event: NotifyEvent) {
  void dispatchNotification(db, event).catch(() => undefined);
}
