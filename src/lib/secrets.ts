/**
 * Central access point for the three long-lived secrets the control plane needs.
 *
 * Development keeps working with well-known placeholders so `npm run dev` needs no
 * setup. Production refuses to use them: every accessor throws unless the operator
 * supplied a value of at least MIN_SECRET_LENGTH characters.
 *
 * Keep this module free of `node:` imports — `src/middleware.ts` runs on the edge
 * runtime and imports it.
 */

export const MIN_SECRET_LENGTH = 32;

export const DEV_SECRET_DEFAULTS = {
  SESSION_SECRET: "dev-only-session-secret-change-me",
  TICKET_SIGNING_KEY: "dev-only-ticket-hmac-key-change",
  DEVICE_SECRET_KEY: "dev-device-secret-key-32bytes!!",
} as const;

export type SecretName = keyof typeof DEV_SECRET_DEFAULTS;

export const SECRET_NAMES = Object.keys(DEV_SECRET_DEFAULTS) as SecretName[];

export class MissingSecretError extends Error {
  readonly secretName: SecretName;

  constructor(secretName: SecretName, reason: string) {
    super(
      `${secretName} ${reason}. Set it to a random value of at least ${MIN_SECRET_LENGTH} characters, ` +
        `for example: ${secretName}=$(openssl rand -base64 48)`,
    );
    this.name = "MissingSecretError";
    this.secretName = secretName;
  }
}

type Env = Record<string, string | undefined>;

function isProduction(env: Env): boolean {
  return env.NODE_ENV === "production";
}

export function readSecret(name: SecretName, env: Env = process.env): string {
  const value = (env[name] ?? "").trim();
  if (!isProduction(env)) {
    return value || DEV_SECRET_DEFAULTS[name];
  }
  if (!value) throw new MissingSecretError(name, "is required in production");
  if (value === DEV_SECRET_DEFAULTS[name]) {
    throw new MissingSecretError(name, "is still the development placeholder");
  }
  if (value.length < MIN_SECRET_LENGTH) {
    throw new MissingSecretError(name, `must be at least ${MIN_SECRET_LENGTH} characters in production`);
  }
  return value;
}

export function sessionSecret(env: Env = process.env): string {
  return readSecret("SESSION_SECRET", env);
}

export function ticketSigningKey(env: Env = process.env): string {
  return readSecret("TICKET_SIGNING_KEY", env);
}

export function deviceSecretKey(env: Env = process.env): string {
  return readSecret("DEVICE_SECRET_KEY", env);
}

/**
 * Validate every secret at once. Called from `src/instrumentation.ts` so a
 * misconfigured production server fails at startup rather than on first request.
 */
export function assertProductionSecrets(env: Env = process.env): void {
  if (!isProduction(env)) return;
  const problems: string[] = [];
  for (const name of SECRET_NAMES) {
    try {
      readSecret(name, env);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (problems.length) {
    throw new Error(`PrivGate cannot start in production:\n  - ${problems.join("\n  - ")}`);
  }
}
