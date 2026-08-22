import { describe, expect, it } from "vitest";
import {
  DEV_SECRET_DEFAULTS,
  MIN_SECRET_LENGTH,
  MissingSecretError,
  SECRET_NAMES,
  assertProductionSecrets,
  readSecret,
} from "./secrets";

const strong = "x".repeat(MIN_SECRET_LENGTH);

function prod(overrides: Record<string, string | undefined> = {}) {
  return { NODE_ENV: "production", ...overrides };
}

describe("secrets in development", () => {
  it("falls back to the documented placeholder for every secret", () => {
    for (const name of SECRET_NAMES) {
      expect(readSecret(name, { NODE_ENV: "development" })).toBe(DEV_SECRET_DEFAULTS[name]);
    }
  });

  it("prefers a supplied value over the placeholder", () => {
    expect(readSecret("SESSION_SECRET", { NODE_ENV: "development", SESSION_SECRET: "local" })).toBe("local");
  });
});

describe("secrets in production fail closed", () => {
  it("rejects a missing secret", () => {
    for (const name of SECRET_NAMES) {
      expect(() => readSecret(name, prod())).toThrow(MissingSecretError);
    }
  });

  it("rejects an empty or whitespace-only secret", () => {
    expect(() => readSecret("SESSION_SECRET", prod({ SESSION_SECRET: "   " }))).toThrow(MissingSecretError);
  });

  it("rejects the development placeholder", () => {
    for (const name of SECRET_NAMES) {
      expect(() => readSecret(name, prod({ [name]: DEV_SECRET_DEFAULTS[name] }))).toThrow(MissingSecretError);
    }
  });

  it("rejects a secret shorter than the minimum length", () => {
    const short = "y".repeat(MIN_SECRET_LENGTH - 1);
    expect(() => readSecret("TICKET_SIGNING_KEY", prod({ TICKET_SIGNING_KEY: short }))).toThrow(
      /at least 32 characters/,
    );
  });

  it("accepts a sufficiently long operator-supplied secret", () => {
    expect(readSecret("DEVICE_SECRET_KEY", prod({ DEVICE_SECRET_KEY: strong }))).toBe(strong);
  });
});

describe("assertProductionSecrets", () => {
  it("is a no-op outside production", () => {
    expect(() => assertProductionSecrets({ NODE_ENV: "development" })).not.toThrow();
  });

  it("reports every missing secret at once", () => {
    let message = "";
    try {
      assertProductionSecrets(prod());
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    for (const name of SECRET_NAMES) expect(message).toContain(name);
  });

  it("passes when all three secrets are configured", () => {
    expect(() =>
      assertProductionSecrets(
        prod({ SESSION_SECRET: strong, TICKET_SIGNING_KEY: strong, DEVICE_SECRET_KEY: strong }),
      ),
    ).not.toThrow();
  });
});
