import type { DatabaseSync } from "node:sqlite";
import { decryptSecret, encryptSecret } from "../crypto-secret";
import type { NotificationSettings } from "../models";
import { deviceSecretKey } from "../secrets";

const notificationDefaults: NotificationSettings = {
  emailEnabled: false,
  smtpHost: "",
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: "",
  smtpFrom: "",
  recipients: "",
  passwordSet: false,
  webhookEnabled: false,
  webhookUrl: "",
  onPending: true,
  onApproved: true,
  onDenied: true,
  onJit: true,
  criticalOnly: false,
};

export function getNotificationSettings(db: DatabaseSync): NotificationSettings {
  const row = db.prepare("SELECT * FROM notification_settings WHERE id = 'default'").get() as
    | Record<string, unknown>
    | undefined;
  if (!row) return { ...notificationDefaults };
  return {
    emailEnabled: Number(row.email_enabled) === 1,
    smtpHost: String(row.smtp_host || ""),
    smtpPort: Number(row.smtp_port || 587),
    smtpSecure: Number(row.smtp_secure) === 1,
    smtpUser: String(row.smtp_user || ""),
    smtpFrom: String(row.smtp_from || ""),
    recipients: String(row.recipients || ""),
    passwordSet: Boolean(row.smtp_pass_enc),
    webhookEnabled: Number(row.webhook_enabled) === 1,
    webhookUrl: String(row.webhook_url || ""),
    onPending: Number(row.on_pending) === 1,
    onApproved: Number(row.on_approved) === 1,
    onDenied: Number(row.on_denied) === 1,
    onJit: Number(row.on_jit) === 1,
    criticalOnly: Number(row.critical_only) === 1,
  };
}

export function getNotificationSecrets(db: DatabaseSync): { smtpPass: string } {
  const row = db.prepare("SELECT smtp_pass_enc FROM notification_settings WHERE id = 'default'").get() as
    | { smtp_pass_enc?: string }
    | undefined;
  if (!row?.smtp_pass_enc) return { smtpPass: "" };
  try {
    return { smtpPass: decryptSecret(String(row.smtp_pass_enc), deviceSecretKey()) };
  } catch {
    return { smtpPass: "" };
  }
}

export function saveNotificationSettings(
  db: DatabaseSync,
  patch: Partial<NotificationSettings> & { smtpPass?: string },
) {
  const current = getNotificationSettings(db);
  const next = { ...current, ...patch };
  const existing = db.prepare("SELECT smtp_pass_enc FROM notification_settings WHERE id = 'default'").get() as
    | { smtp_pass_enc?: string }
    | undefined;
  let passEnc = existing?.smtp_pass_enc || "";
  if (patch.smtpPass) passEnc = encryptSecret(patch.smtpPass, deviceSecretKey());
  db.prepare(
    `INSERT INTO notification_settings (
      id, email_enabled, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass_enc, smtp_from, recipients,
      webhook_enabled, webhook_url, on_pending, on_approved, on_denied, on_jit, critical_only
    ) VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email_enabled = excluded.email_enabled,
      smtp_host = excluded.smtp_host,
      smtp_port = excluded.smtp_port,
      smtp_secure = excluded.smtp_secure,
      smtp_user = excluded.smtp_user,
      smtp_pass_enc = excluded.smtp_pass_enc,
      smtp_from = excluded.smtp_from,
      recipients = excluded.recipients,
      webhook_enabled = excluded.webhook_enabled,
      webhook_url = excluded.webhook_url,
      on_pending = excluded.on_pending,
      on_approved = excluded.on_approved,
      on_denied = excluded.on_denied,
      on_jit = excluded.on_jit,
      critical_only = excluded.critical_only`,
  ).run(
    next.emailEnabled ? 1 : 0,
    next.smtpHost,
    next.smtpPort,
    next.smtpSecure ? 1 : 0,
    next.smtpUser,
    passEnc,
    next.smtpFrom,
    next.recipients,
    next.webhookEnabled ? 1 : 0,
    next.webhookUrl,
    next.onPending ? 1 : 0,
    next.onApproved ? 1 : 0,
    next.onDenied ? 1 : 0,
    next.onJit ? 1 : 0,
    next.criticalOnly ? 1 : 0,
  );
}
