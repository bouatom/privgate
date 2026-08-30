import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getDb, resetDbForTests, saveAdSettings, saveNotificationSettings } from "./db";
import { setUpdateChannel } from "./setup-state";
import { missingVersionManifestPath } from "@/test/version-manifest";
import { identitySummary, settingsOverview } from "./settings-overview";

// Hermetic data dir + installed version so the overview never touches a real
// console.env / cache and version resolution is deterministic.
const PREVIOUS = new Map<string, string | undefined>();
let dataDir = "";

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "privgate-overview-"));
  for (const key of ["PRIVGATE_DATA_DIR", "PRIVGATE_VERSION", "PRIVGATE_VERSION_FILE"]) {
    PREVIOUS.set(key, process.env[key]);
  }
  process.env.PRIVGATE_DATA_DIR = dataDir;
  process.env.PRIVGATE_VERSION = "0.3.3";
  process.env.PRIVGATE_VERSION_FILE = missingVersionManifestPath();
  resetDbForTests(":memory:");
});

afterEach(() => {
  for (const [key, value] of PREVIOUS) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dataDir, { recursive: true, force: true });
});

describe("settingsOverview", () => {
  it("reports defaults for a fresh install", () => {
    const view = settingsOverview(getDb(), process.env);

    expect(view.server).toMatchObject({
      bind: "0.0.0.0",
      webPort: 3000,
      agentPort: 3001,
      splitPorts: true,
      loopback: false,
    });
    expect(view.server.lanUrls.length).toBeGreaterThan(0);
    // lanUrls excludes loopback by contract: only addresses other machines
    // can reach.
    expect(view.server.lanUrls.every((url) => !url.includes("127.0.0.1"))).toBe(true);
    expect(view.identity.entra).toEqual({ connected: false, name: null, lastSyncAt: null });
    expect(view.identity.ad.connected).toBe(false);
    expect(identitySummary(view)).toBe("No identity sources connected");
    // The seeded DB carries a default alert recipient; only assert the
    // disabled/toggle state for a fresh install.
    expect(view.notifications).toMatchObject({ emailEnabled: false, webhookEnabled: false, enabled: false });
    expect(view.updates).toMatchObject({
      version: "0.3.3",
      versionSource: "env",
      channel: "official",
      available: false,
      availableVersion: null,
      checkedAt: null,
    });
  });

  it("reflects connected identity sources", () => {
    saveAdSettings(getDb(), { host: "dc01.contoso.test" });
    const view = settingsOverview(getDb(), process.env);

    expect(view.identity.ad.connected).toBe(true);
    expect(view.identity.ad.name).toBe("dc01.contoso.test");
    expect(identitySummary(view)).toBe("AD (dc01.contoso.test)");
  });

  it("reflects notification and channel state", () => {
    saveNotificationSettings(getDb(), { emailEnabled: true, webhookEnabled: true });
    setUpdateChannel(getDb(), "nightly");
    const view = settingsOverview(getDb(), process.env);

    expect(view.notifications.enabled).toBe(true);
    expect(view.notifications.emailEnabled).toBe(true);
    expect(view.notifications.webhookEnabled).toBe(true);
    expect(view.updates.channel).toBe("nightly");
  });

  it("flags loopback binds and falls back to loopback LAN URLs", () => {
    const view = settingsOverview(getDb(), { ...process.env, PRIVGATE_BIND: "127.0.0.1" });

    expect(view.server.loopback).toBe(true);
    expect(view.server.lanUrls).toEqual(["http://127.0.0.1:3000"]);
  });
});