import { describe, it, expect } from "vitest";
import { validateAgentOrigin } from "./agent-origin";

const mockLogger = {
  warn: () => {},
  error: () => {},
  log: () => {},
};

describe("validateAgentOrigin", () => {
  it("accepts matching origin", () => {
    const env = { PRIVGATE_AGENT_ORIGIN: "https://privgate.example.com:3001" };
    const result = validateAgentOrigin("https://privgate.example.com:3001", env, mockLogger);
    expect(result).toBe(true);
  });

  it("rejects mismatched origin", () => {
    const env = { PRIVGATE_AGENT_ORIGIN: "https://privgate.example.com:3001" };
    const result = validateAgentOrigin("https://attacker.com:3001", env, mockLogger);
    expect(result).toBe(false);
  });

  it("accepts case-insensitive match", () => {
    const env = { PRIVGATE_AGENT_ORIGIN: "https://PrivGate.Example.com:3001" };
    const result = validateAgentOrigin("https://privgate.example.com:3001", env, mockLogger);
    expect(result).toBe(true);
  });

  it("rejects missing origin", () => {
    const env = { PRIVGATE_AGENT_ORIGIN: "https://privgate.example.com:3001" };
    const result = validateAgentOrigin("", env, mockLogger);
    expect(result).toBe(false);
  });

  it("rejects when neither explicit nor public origin configured", () => {
    const env = {};
    const result = validateAgentOrigin("https://privgate.example.com:3001", env, mockLogger);
    expect(result).toBe(false);
  });

  it("derives agent origin from public origin when explicit not set", () => {
    const env = {
      PRIVGATE_PUBLIC_ORIGIN: "https://privgate.example.com",
      PRIVGATE_AGENT_PORT: "3001",
    };
    const result = validateAgentOrigin("https://privgate.example.com:3001", env, mockLogger);
    expect(result).toBe(true);
  });

  it("rejects mismatched port", () => {
    const env = { PRIVGATE_AGENT_ORIGIN: "https://privgate.example.com:3001" };
    const result = validateAgentOrigin("https://privgate.example.com:3000", env, mockLogger);
    expect(result).toBe(false);
  });

  it("rejects mismatched scheme", () => {
    const env = { PRIVGATE_AGENT_ORIGIN: "https://privgate.example.com:3001" };
    const result = validateAgentOrigin("http://privgate.example.com:3001", env, mockLogger);
    expect(result).toBe(false);
  });
});
