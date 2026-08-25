import { describe, expect, it } from "vitest";
import { isNewer, updateStateFor } from "./device-update-state";

describe("isNewer", () => {
  it("compares three-part releases numerically", () => {
    expect(isNewer("0.3.0", "0.2.1")).toBe(true);
    expect(isNewer("0.2.10", "0.2.9")).toBe(true);
    expect(isNewer("1.0.0", "1.0.0")).toBe(false);
    expect(isNewer("0.2.0", "0.2.1")).toBe(false);
  });

  it("ignores a leading v and prerelease/build suffixes before comparing", () => {
    expect(isNewer("v0.3.0", "0.2.9")).toBe(true);
    expect(isNewer("0.4.0-beta.1", "0.3.9+build.7")).toBe(true);
    expect(isNewer("0.2.1-rc.1", "v0.2.1")).toBe(false);
  });

  it("treats missing segments as zero", () => {
    expect(isNewer("1.1", "1.0.9")).toBe(true);
    expect(isNewer("1", "1.0.0")).toBe(false);
  });
});

describe("updateStateFor", () => {
  it("flags a +pending build as updating with the pending tone", () => {
    const state = updateStateFor({ agentVersion: "0.3.0+pending", updateRequestedAt: null }, "0.3.0");
    expect(state).toEqual({ kind: "updating", label: "updating…", tone: "pending" });
  });

  it("flags a +stale build as failed even when an update request is outstanding", () => {
    const state = updateStateFor(
      { agentVersion: "0.2.0+stale", updateRequestedAt: "2026-08-20T10:00:00Z" },
      "0.3.0",
    );
    expect(state).toEqual({ kind: "failed", label: "update failed?", tone: "pending" });
  });

  it("marks a device with an outstanding request as queued (active tone)", () => {
    const state = updateStateFor({ agentVersion: "0.2.0", updateRequestedAt: "2026-08-20T10:00:00Z" }, "0.3.0");
    expect(state).toEqual({ kind: "queued", label: "update queued", tone: "active" });
  });

  it("shows the stale arrow when the console ships a newer release than the agent", () => {
    const state = updateStateFor({ agentVersion: "0.2.1", updateRequestedAt: null }, "0.3.0");
    expect(state).toEqual({ kind: "stale", label: "v0.2.1 → 0.3.0", tone: "pending" });
  });

  it("keeps up-to-date agents on the active tone with their plain version", () => {
    const state = updateStateFor({ agentVersion: "0.3.0", updateRequestedAt: null }, "0.3.0");
    expect(state).toEqual({ kind: "current", label: "v0.3.0", tone: "active" });
  });

  it("falls back to the unknown pill when the PC never reported a version", () => {
    const state = updateStateFor({ agentVersion: "", updateRequestedAt: null }, "0.3.0");
    expect(state).toEqual({ kind: "current", label: "v unknown", tone: "" });
  });
});
