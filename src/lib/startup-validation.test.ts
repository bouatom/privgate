import { describe, it, expect } from "vitest";
import { validateStartupSecrets } from "./startup-validation";

describe("validateStartupSecrets", () => {
  it("accepts valid secrets", () => {
    const env = {
      SESSION_SECRET: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEF",
      TICKET_SIGNING_KEY: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEF",
      DEVICE_SECRET_KEY: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEF",
    };
    const result = validateStartupSecrets(env);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("rejects missing SESSION_SECRET", () => {
    const env = {
      SESSION_SECRET: undefined,
      TICKET_SIGNING_KEY: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEF",
      DEVICE_SECRET_KEY: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEF",
    };
    const result = validateStartupSecrets(env);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("SESSION_SECRET");
    expect(result.error).toContain("missing");
  });

  it("rejects empty TICKET_SIGNING_KEY", () => {
    const env = {
      SESSION_SECRET: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEF",
      TICKET_SIGNING_KEY: "",
      DEVICE_SECRET_KEY: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEF",
    };
    const result = validateStartupSecrets(env);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("TICKET_SIGNING_KEY");
  });

  it("rejects DEVICE_SECRET_KEY that is too short", () => {
    const env = {
      SESSION_SECRET: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEF",
      TICKET_SIGNING_KEY: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEF",
      DEVICE_SECRET_KEY: "short",
    };
    const result = validateStartupSecrets(env);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("DEVICE_SECRET_KEY");
    expect(result.error).toContain("too short");
  });

  it("rejects placeholder 'development' in SESSION_SECRET", () => {
    const env = {
      SESSION_SECRET: "development",
      TICKET_SIGNING_KEY: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEF",
      DEVICE_SECRET_KEY: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEF",
    };
    const result = validateStartupSecrets(env);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("placeholder");
  });

  it("rejects placeholder 'placeholder' in TICKET_SIGNING_KEY", () => {
    const env = {
      SESSION_SECRET: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEF",
      TICKET_SIGNING_KEY: "placeholder",
      DEVICE_SECRET_KEY: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEF",
    };
    const result = validateStartupSecrets(env);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("placeholder");
  });

  it("rejects DEVICE_SECRET_KEY with insufficient entropy (repeated char)", () => {
    const env = {
      SESSION_SECRET: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEF",
      TICKET_SIGNING_KEY: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEF",
      DEVICE_SECRET_KEY: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    const result = validateStartupSecrets(env);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("entropy");
  });

  it("rejects 'change-me' placeholder", () => {
    const env = {
      SESSION_SECRET: "change-me-123456789abcdefghijklmnop",
      TICKET_SIGNING_KEY: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEF",
      DEVICE_SECRET_KEY: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEF",
    };
    const result = validateStartupSecrets(env);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("placeholder");
  });

  it("accepts secrets generated with crypto.randomBytes(32).toString('base64url')", () => {
    // Simulated output from crypto.randomBytes(32).toString('base64url')
    const env = {
      SESSION_SECRET: "7HdT_RfQi2E-K4mN8pLvWx9ZaBcDeFgHiJkLmNoPqRs",
      TICKET_SIGNING_KEY: "qRsT9UvWxY0aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0u",
      DEVICE_SECRET_KEY: "aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX2yZ3zA",
    };
    const result = validateStartupSecrets(env);
    expect(result.ok).toBe(true);
  });
});
