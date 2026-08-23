import type { DatabaseSync } from "node:sqlite";
import { appendAudit } from "./db/audit";

export interface ConfigChangeDetails {
  [key: string]: {
    old?: unknown;
    new?: unknown;
  };
}

/**
 * Redacts sensitive fields from configuration objects.
 * Returns '[redacted]' for passwords and keys, or a fingerprint for verification.
 */
function redactSensitive(value: unknown, fieldName: string): unknown {
  if (typeof value !== "string") return value;
  const lowerName = fieldName.toLowerCase();
  if (lowerName.includes("password") || lowerName.includes("secret") || lowerName.includes("key")) {
    return value ? "[redacted]" : undefined;
  }
  return value;
}

/**
 * Compares two configuration objects and creates a change diff.
 * Redacts sensitive fields automatically.
 *
 * @param oldConfig Previous configuration state
 * @param newConfig New configuration state
 * @returns Object mapping field names to { old, new } values
 */
export function diffConfigs(
  oldConfig: Record<string, unknown> = {},
  newConfig: Record<string, unknown> = {},
): ConfigChangeDetails {
  const changes: ConfigChangeDetails = {};
  const allKeys = new Set([...Object.keys(oldConfig), ...Object.keys(newConfig)]);

  for (const key of allKeys) {
    const oldVal = oldConfig[key];
    const newVal = newConfig[key];
    if (oldVal !== newVal) {
      changes[key] = {
        old: redactSensitive(oldVal, key),
        new: redactSensitive(newVal, key),
      };
    }
  }

  return changes;
}

/**
 * Logs a configuration change to the audit trail.
 * Automatically tracks old vs. new values and redacts sensitive fields.
 *
 * @param db Database connection
 * @param actor Email or identifier of the user making the change
 * @param configType Type of configuration (e.g., 'ad', 'entra', 'policy', 'user.role')
 * @param target Specific target being configured (e.g., device ID, policy ID, user ID)
 * @param oldConfig Previous configuration state
 * @param newConfig New configuration state
 * @param additionalDetails Optional extra details to include in audit
 */
export function auditConfigChange(
  db: DatabaseSync,
  actor: string,
  configType: string,
  target: string,
  oldConfig: Record<string, unknown>,
  newConfig: Record<string, unknown>,
  additionalDetails?: Record<string, unknown>,
): void {
  const changes = diffConfigs(oldConfig, newConfig);
  const details = {
    changes,
    ...additionalDetails,
  };

  appendAudit(db, actor, `config.${configType}.update`, target, details);
}

/**
 * Logs a configuration access or view event.
 * Use this for sensitive operations like viewing connection strings or test results.
 *
 * @param db Database connection
 * @param actor Email or identifier of the user
 * @param configType Type of configuration being accessed
 * @param target Specific target being accessed
 * @param details Optional extra details
 */
export function auditConfigAccess(
  db: DatabaseSync,
  actor: string,
  configType: string,
  target: string,
  details?: Record<string, unknown>,
): void {
  appendAudit(db, actor, `config.${configType}.access`, target, details || {});
}

/**
 * Logs a secret rotation or renewal event.
 * Does NOT log the secret itself, only that it was rotated.
 *
 * @param db Database connection
 * @param secretName Name of the secret rotated (e.g., 'device-secret-key', 'signing-key')
 * @param executedBy Email or identifier of the user or system component
 * @param details Optional extra details (e.g., reason, previous fingerprint)
 */
export function auditSecretRotation(
  db: DatabaseSync,
  secretName: string,
  executedBy: string,
  details?: Record<string, unknown>,
): void {
  appendAudit(
    db,
    executedBy,
    "secret.rotate",
    secretName,
    {
      rotatedAt: new Date().toISOString(),
      ...details,
    },
  );
}
