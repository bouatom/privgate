import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { isIPv4 } from "node:net";
import { appendAudit } from "./db/audit";
import { getNotificationSecrets, getNotificationSettings, getUser, getDevice } from "./db";
import { sendSmtp } from "./smtp";

/** Block SSRF against private / loopback / link-local / internal addresses. */
function isPrivateOrReservedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h === "") return true;
  // IPv6 loopback / link-local / mapped
  if (h === "::1" || h === "[::1]" || h.startsWith("fe80") || h.startsWith("fc") || h.startsWith("fd")) return true;
  if (!isIPv4(h)) return false;
  const parts = h.split(".").map(Number);
  if (parts.length !== 4) return false;
  if (parts[0] === 0 || parts[0] === 10) return true;                             // "this network", private 10/8
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;        // 100.64/10 (CGNAT)
  if (parts[0] === 127) return true;                                               // loopback 127/8
  if (parts[0] === 169 && parts[1] === 254) return true;                          // link-local 169.254/16
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;         // private 172.16/12
  if (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) return true;         // IETF protocol
  if (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) return true;         // documentation
  if (parts[0] === 192 && parts[1] === 168) return true;                          // private 192.168/16
  if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true;     // 198.18/15
  if (parts[0] === 224) return true;                                               // multicast
  return false;
}

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
      const url = new URL(settings.webhookUrl);
      if (isPrivateOrReservedHost(url.hostname)) {
        errors.push("webhook URL points to a private/reserved address");
      } else {
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
      }
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
  // Fire-and-forget: dispatch failures must not break the request that queued
  // the notification, but they must not vanish either — operators only find
  // out notifications are silently broken if the failure is auditable.
  void dispatchNotification(db, event).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    try {
      appendAudit(db, "system", "notify.failed", event.kind, { error: message, title: event.title });
    } catch {
      // Even the audit write failing (e.g. locked DB) must not raise here.
    }
  });
}
