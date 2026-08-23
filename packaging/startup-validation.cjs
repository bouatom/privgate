"use strict";

/**
 * Production-entry secret checks. This file is CommonJS on purpose: the
 * Windows/macOS/Linux service runs `node host.cjs`, which cannot load
 * TypeScript and does not ship `src/`.
 */

const MIN_SECRET_LENGTH = 32;
const SECRET_NAMES = ["SESSION_SECRET", "TICKET_SIGNING_KEY", "DEVICE_SECRET_KEY"];

function validateStartupSecrets(env = process.env) {
  for (const name of SECRET_NAMES) {
    const value = env[name];
    if (!value) {
      return { ok: false, error: `Secret '${name}' is missing or empty` };
    }

    const lowerValue = String(value).toLowerCase();
    if (
      lowerValue === "development" ||
      lowerValue === "placeholder" ||
      lowerValue.includes("placeholder") ||
      lowerValue.includes("todo") ||
      lowerValue.includes("change-me") ||
      lowerValue.includes("changeme")
    ) {
      return {
        ok: false,
        error: `Secret '${name}' contains a placeholder value. Replace with a randomly generated secret (at least ${MIN_SECRET_LENGTH} bytes, base64-encoded).`,
      };
    }

    if (value.length < MIN_SECRET_LENGTH) {
      return {
        ok: false,
        error: `Secret '${name}' is too short (${value.length} bytes, minimum ${MIN_SECRET_LENGTH} required)`,
      };
    }

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

function validateStartupSecretsOrExit(env = process.env, logger = console) {
  const result = validateStartupSecrets(env);
  if (!result.ok) {
    logger.error(`PrivGate startup validation failed: ${result.error}`);
    process.exit(1);
  }
  return true;
}

module.exports = {
  SECRET_NAMES,
  validateStartupSecrets,
  validateStartupSecretsOrExit,
};
