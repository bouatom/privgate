import type { Logger } from "node:console";

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * Validates critical cryptographic secrets at startup.
 * Ensures all secrets meet minimum entropy and length requirements.
 *
 * @param env Environment variables to validate
 * @param logger Optional logger for diagnostics (defaults to console)
 * @returns { ok: true } if all secrets are valid, { ok: false; error: string } otherwise
 */
export function validateStartupSecrets(
  env: Record<string, string | undefined> = process.env,
  logger: Logger = console,
): ValidationResult {
  const MIN_SECRET_LENGTH = 32; // 32 bytes base64 ≈ 24 bytes raw = 192 bits entropy

  const secrets = [
    { name: "SESSION_SECRET", value: env.SESSION_SECRET },
    { name: "TICKET_SIGNING_KEY", value: env.TICKET_SIGNING_KEY },
    { name: "DEVICE_SECRET_KEY", value: env.DEVICE_SECRET_KEY },
  ];

  for (const { name, value } of secrets) {
    // Check if secret exists
    if (!value) {
      return {
        ok: false,
        error: `Secret '${name}' is missing or empty`,
      };
    }

    // Check minimum length
    if (value.length < MIN_SECRET_LENGTH) {
      return {
        ok: false,
        error: `Secret '${name}' is too short (${value.length} bytes, minimum ${MIN_SECRET_LENGTH} required)`,
      };
    }

    // Reject known placeholder values
    const lowerValue = value.toLowerCase();
    if (
      lowerValue === "development" ||
      lowerValue === "placeholder" ||
      lowerValue.includes("placeholder") ||
      lowerValue.includes("TODO".toLowerCase()) ||
      lowerValue === "change-me" ||
      lowerValue === "changeme"
    ) {
      return {
        ok: false,
        error: `Secret '${name}' contains a placeholder value. Replace with a randomly generated secret (at least ${MIN_SECRET_LENGTH} bytes, base64-encoded).`,
      };
    }

    // Warn if secret looks too simple (all same character, too few unique chars)
    const uniqueChars = new Set(value).size;
    if (uniqueChars < 8) {
      return {
        ok: false,
        error: `Secret '${name}' has insufficient entropy (only ${uniqueChars} unique characters). Use crypto.randomBytes(32).toString('base64url') to generate.`,
      };
    }
  }

  return { ok: true };
}

/**
 * Wrapper for validateStartupSecrets() that logs and exits on failure.
 * Intended for use in startup hooks.
 *
 * @param env Environment variables to validate
 * @param logger Optional logger for diagnostics
 * @returns true if all secrets are valid, false (and exits process) otherwise
 */
export function validateStartupSecretsOrExit(
  env: Record<string, string | undefined> = process.env,
  logger: Logger = console,
): boolean {
  const result = validateStartupSecrets(env, logger);
  if (!result.ok) {
    logger.error(`PrivGate startup validation failed: ${result.error}`);
    process.exit(1);
  }
  return true;
}
