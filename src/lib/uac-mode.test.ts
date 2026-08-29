import { afterEach, describe, expect, it } from "vitest";
import { getElevationSettings, resetDbForTests, saveElevationSettings } from "./db";
import { parseUacMode } from "./uac-mode";
import { handleAgentRpc } from "./realtime/rpc";
import { registerDeviceSocket, resetRealtimeForTests } from "./realtime/bus";

afterEach(() => {
  resetRealtimeForTests();
  resetDbForTests(":memory:");
});

describe("uac mode", () => {
  it("treats anything but collect as prompt", () => {
    expect(parseUacMode("collect")).toBe("collect");
    expect(parseUacMode("PROMPT")).toBe("prompt");
    expect(parseUacMode("")).toBe("prompt");
    expect(parseUacMode("drop table")).toBe("prompt");
  });

  it("defaults to prompt and persists collect", () => {
    const db = resetDbForTests(":memory:");
    expect(getElevationSettings(db).uacMode).toBe("prompt");
    expect(saveElevationSettings(db, "collect")).toEqual({ uacMode: "collect" });
    expect(getElevationSettings(db).uacMode).toBe("collect");
  });

  it("returns the current mode on client-status heartbeats", () => {
    const db = resetDbForTests(":memory:");
    saveElevationSettings(db, "collect");
    const stop = registerDeviceSocket("dev-lab-01", { send: () => {}, ready: () => true });
    const res = handleAgentRpc("dev-lab-01", { type: "client-status", uptimeSec: 12, pid: 99 });
    expect(res).toMatchObject({ ok: true, payload: { recorded: true, uacMode: "collect" } });
    stop();
  });
});
