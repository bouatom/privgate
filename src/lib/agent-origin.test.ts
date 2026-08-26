import { describe, it, expect } from "vitest";
import { expectedAgentOrigin, validateAgentOrigin } from "./agent-origin";

const mockLogger = {
  warn: () => {},
  error: () => {},
  log: () => {},
};

describe("validateAgentOrigin", () => {
  it("accepts matching origin", () => {
    const env = { PRIVGATE_AGENT_ORIGIN: "https://privgate.example.com:3001" };
    expect(validateAgentOrigin("https://privgate.example.com:3001", env, mockLogger)).toBe(true);
  });

  it("rejects mismatched origin", () => {
    const env = { PRIVGATE_AGENT_ORIGIN: "https://privgate.example.com:3001" };
    expect(validateAgentOrigin("https://attacker.com:3001", env, mockLogger)).toBe(false);
  });

  it("accepts case-insensitive match", () => {
    const env = { PRIVGATE_AGENT_ORIGIN: "https://PrivGate.Example.com:3001" };
    expect(validateAgentOrigin("https://privgate.example.com:3001", env, mockLogger)).toBe(true);
  });

  it("allows missing origin from native ClientWebSocket", () => {
    const env = { PRIVGATE_AGENT_ORIGIN: "https://privgate.example.com:3001" };
    expect(validateAgentOrigin("", env, mockLogger)).toBe(true);
  });

  it("accepts the literal \"null\" sentinel origin even when an origin is configured", () => {
    const env = { PRIVGATE_AGENT_ORIGIN: "https://privgate.example.com:3001" };
    expect(validateAgentOrigin("null", env, mockLogger)).toBe(true);
  });

  it("normalizes whitespace and case on the \"null\" sentinel", () => {
    const env = { PRIVGATE_AGENT_ORIGIN: "https://privgate.example.com:3001" };
    expect(validateAgentOrigin(" Null ", env, mockLogger)).toBe(true);
    expect(validateAgentOrigin("NULL", env, mockLogger)).toBe(true);
  });

  it("allows the \"null\" sentinel when nothing is configured", () => {
    expect(validateAgentOrigin("null", {}, mockLogger)).toBe(true);
  });

  it("still rejects a wrong non-null origin next to accepted sentinels", () => {
    const env = { PRIVGATE_AGENT_ORIGIN: "https://privgate.example.com:3001" };
    expect(validateAgentOrigin("null", env, mockLogger)).toBe(true);
    expect(validateAgentOrigin("", env, mockLogger)).toBe(true);
    expect(validateAgentOrigin("https://attacker.com:3001", env, mockLogger)).toBe(false);
  });

  it("allows native missing origin when nothing is configured", () => {
    expect(validateAgentOrigin("", {}, mockLogger)).toBe(true);
  });

  it("allows a present origin on LAN when expected cannot be computed", () => {
    expect(validateAgentOrigin("https://privgate.example.com:3001", {}, mockLogger)).toBe(true);
  });

  it("derives agent origin from public origin when explicit not set", () => {
    const env = {
      PRIVGATE_PUBLIC_ORIGIN: "https://privgate.example.com",
      PRIVGATE_AGENT_PORT: "3001",
    };
    expect(expectedAgentOrigin(env, mockLogger)).toBe("https://privgate.example.com:3001");
    expect(validateAgentOrigin("https://privgate.example.com:3001", env, mockLogger)).toBe(true);
  });

  it("rejects mismatched port", () => {
    const env = { PRIVGATE_AGENT_ORIGIN: "https://privgate.example.com:3001" };
    expect(validateAgentOrigin("https://privgate.example.com:3000", env, mockLogger)).toBe(false);
  });

  it("rejects mismatched scheme", () => {
    const env = { PRIVGATE_AGENT_ORIGIN: "https://privgate.example.com:3001" };
    expect(validateAgentOrigin("http://privgate.example.com:3001", env, mockLogger)).toBe(false);
  });

  it("falls back to HMAC-only when the configured origin is invalid", () => {
    const env = { PRIVGATE_AGENT_ORIGIN: "not-a-url" };
    expect(expectedAgentOrigin(env, mockLogger)).toBe(null);
    expect(validateAgentOrigin("https://anything.example.com:3001", env, mockLogger)).toBe(true);
  });
});
