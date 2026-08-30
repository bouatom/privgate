import { describe, expect, it } from "vitest";
import {
  describeServerTarget,
  parseServerTarget,
  serverTargetEquals,
} from "./server-settings";
import {
  SERVER_APPLY_STALE_MS,
  SERVER_UPDATER_START_WINDOW_MS,
  parseServerApplyStatus,
  type ServerApplyState,
} from "./server-settings-state";

describe("parseServerTarget", () => {
  it("accepts a valid wildcard target with numeric ports", () => {
    const result = parseServerTarget({ bind: "0.0.0.0", webPort: 3000, agentPort: 3001 });
    expect(result).toEqual({ ok: true, target: { bind: "0.0.0.0", webPort: 3000, agentPort: 3001 } });
  });

  it("accepts a loopback bind and numeric-string ports", () => {
    const result = parseServerTarget({ bind: "127.0.0.1", webPort: "3000", agentPort: "3001" });
    expect(result).toEqual({ ok: true, target: { bind: "127.0.0.1", webPort: 3000, agentPort: 3001 } });
  });

  it("trims whitespace around the bind address", () => {
    const result = parseServerTarget({ bind: "  0.0.0.0  ", webPort: 3000, agentPort: 3001 });
    expect(result.ok && result.target.bind).toBe("0.0.0.0");
  });

  it("allows agentPort equal to webPort (single listening port)", () => {
    const result = parseServerTarget({ bind: "0.0.0.0", webPort: 3000, agentPort: 3000 });
    expect(result).toEqual({ ok: true, target: { bind: "0.0.0.0", webPort: 3000, agentPort: 3000 } });
  });

  it("rejects a non-object body", () => {
    expect(parseServerTarget(null)).toEqual({ ok: false, error: "Missing server settings." });
  });

  it("rejects a missing or empty bind address", () => {
    expect(parseServerTarget({ webPort: 3000, agentPort: 3001 })).toEqual({
      ok: false,
      error: "Bind address is required.",
    });
    expect(parseServerTarget({ bind: "   ", webPort: 3000, agentPort: 3001 })).toEqual({
      ok: false,
      error: "Bind address is required.",
    });
  });

  it("rejects a bind address with spaces", () => {
    expect(parseServerTarget({ bind: "192.168.1.20 extra", webPort: 3000, agentPort: 3001 })).toEqual({
      ok: false,
      error: "Bind address must be a single address or hostname.",
    });
  });

  it("rejects malformed ports", () => {
    expect(parseServerTarget({ bind: "0.0.0.0", webPort: 0, agentPort: 3001 })).toEqual({
      ok: false,
      error: "Web port must be an integer between 1 and 65535.",
    });
    expect(parseServerTarget({ bind: "0.0.0.0", webPort: 70000, agentPort: 3001 })).toEqual({
      ok: false,
      error: "Web port must be an integer between 1 and 65535.",
    });
    expect(parseServerTarget({ bind: "0.0.0.0", webPort: 3000, agentPort: "abc" })).toEqual({
      ok: false,
      error: "Broker port must be an integer between 1 and 65535.",
    });
    expect(parseServerTarget({ bind: "0.0.0.0", webPort: 3000.5, agentPort: 3001 })).toEqual({
      ok: false,
      error: "Web port must be an integer between 1 and 65535.",
    });
  });
});

describe("serverTargetEquals", () => {
  it("is true for identical targets", () => {
    expect(serverTargetEquals({ bind: "0.0.0.0", webPort: 3000, agentPort: 3001 }, { bind: "0.0.0.0", webPort: 3000, agentPort: 3001 })).toBe(true);
  });

  it("is false when any field differs", () => {
    expect(serverTargetEquals({ bind: "0.0.0.0", webPort: 3000, agentPort: 3001 }, { bind: "127.0.0.1", webPort: 3000, agentPort: 3001 })).toBe(false);
    expect(serverTargetEquals({ bind: "0.0.0.0", webPort: 3000, agentPort: 3001 }, { bind: "0.0.0.0", webPort: 8080, agentPort: 3001 })).toBe(false);
    expect(serverTargetEquals({ bind: "0.0.0.0", webPort: 3000, agentPort: 3001 }, { bind: "0.0.0.0", webPort: 3000, agentPort: 3000 })).toBe(false);
  });
});

describe("describeServerTarget", () => {
  it("includes the broker port only when split", () => {
    expect(describeServerTarget({ bind: "0.0.0.0", webPort: 3000, agentPort: 3001 })).toBe("0.0.0.0:3000 (broker 3001)");
    expect(describeServerTarget({ bind: "0.0.0.0", webPort: 3000, agentPort: 3000 })).toBe("0.0.0.0:3000");
  });
});

describe("parseServerApplyStatus", () => {
  const logFile = "/data/server-settings/apply.log";
  const nowMs = 1_750_000_000_000;
  const state = (startedAt: string): ServerApplyState => ({
    target: { bind: "0.0.0.0", webPort: 8080, agentPort: 8081 },
    startedAt,
    logFile,
  });
  const startedAt = new Date(nowMs - 5_000).toISOString();

  it("reports idle with no state file", () => {
    const view = parseServerApplyStatus({ state: null, logText: "", nowMs });
    expect(view.phase).toBe("idle");
    expect(view.target).toBeNull();
    expect(view.startedAt).toBeNull();
    expect(view.lastLines).toEqual([]);
    expect(view.hint).toBeNull();
    expect(view.abandonable).toBe(false);
  });

  it("reports running for a fresh state with no markers", () => {
    const view = parseServerApplyStatus({ state: state(startedAt), logText: "==> PrivGate server settings apply: 0.0.0.0:8080 (broker 8081)", nowMs });
    expect(view.phase).toBe("running");
    expect(view.target?.webPort).toBe(8080);
    expect(view.abandonable).toBe(true); // script has not started yet
  });

  it("reports running and not abandonable once the restart script has started", () => {
    const logText = "==> PrivGate server settings apply: 0.0.0.0:8080\n==> handing off to restart script\n==> restart-server start pid=1234";
    const view = parseServerApplyStatus({ state: state(startedAt), logText, nowMs });
    expect(view.phase).toBe("running");
    expect(view.abandonable).toBe(false);
  });

  it("reports succeeded on the applied marker even with stray error text", () => {
    const logText = "==> restart-server start pid=1\n==> server settings applied.\nWARN: nothing";
    const view = parseServerApplyStatus({ state: state(startedAt), logText, nowMs });
    expect(view.phase).toBe("succeeded");
    expect(view.abandonable).toBe(false);
  });

  it("reports failed on an error marker", () => {
    const logText = "==> restart-server start pid=1\nerror: console did not become healthy after applying the server settings";
    const view = parseServerApplyStatus({ state: state(startedAt), logText, nowMs });
    expect(view.phase).toBe("failed");
    expect(view.hint).toContain(logFile);
  });

  it("reports stale when the apply is older than the stale window", () => {
    const oldStartedAt = new Date(nowMs - SERVER_APPLY_STALE_MS - 60_000).toISOString();
    const view = parseServerApplyStatus({ state: state(oldStartedAt), logText: "==> PrivGate server settings apply: 0.0.0.0:8080", nowMs });
    expect(view.phase).toBe("stale");
    expect(view.abandonable).toBe(true);
  });

  it("reports stale when the script never started within the quiet window", () => {
    const oldStartedAt = new Date(nowMs - SERVER_UPDATER_START_WINDOW_MS - 1_000).toISOString();
    const view = parseServerApplyStatus({ state: state(oldStartedAt), logText: "==> PrivGate server settings apply: 0.0.0.0:8080", nowMs });
    expect(view.phase).toBe("stale");
    expect(view.hint).toContain("likely never started");
  });

  it("explains a stale launch when handoff was seen but the script stayed silent", () => {
    const oldStartedAt = new Date(nowMs - SERVER_UPDATER_START_WINDOW_MS - 1_000).toISOString();
    const view = parseServerApplyStatus({
      state: state(oldStartedAt),
      logText: "==> PrivGate server settings apply: 0.0.0.0:8080\n==> handing off to restart script",
      nowMs,
    });
    expect(view.phase).toBe("stale");
    expect(view.hint).toContain("launched but produced no output");
  });

  it("caps lastLines at 15 and drops blanks", () => {
    const lines = Array.from({ length: 25 }, (_, i) => `line ${i}`);
    const view = parseServerApplyStatus({
      state: state(startedAt),
      logText: lines.join("\n") + "\n\n",
      nowMs,
    });
    expect(view.lastLines).toHaveLength(15);
    expect(view.lastLines[0]).toBe("line 10");
    expect(view.lastLines[14]).toBe("line 24");
  });
});