import { afterEach, describe, expect, it } from "vitest";
import { compareVersions, currentClientVersion, sanitizeClientVersion, updateAvailable } from "./client-version";
import { resetDbForTests } from "./db";

afterEach(() => {
  delete process.env.PRIVGATE_VERSION;
  resetDbForTests(":memory:");
});

describe("sanitizeClientVersion", () => {
  it("keeps numeric x.y.z and strips prefixes and metadata", () => {
    expect(sanitizeClientVersion("0.2.1")).toBe("0.2.1");
    expect(sanitizeClientVersion("v1.2.3-beta.4+build.9")).toBe("1.2.3");
    expect(sanitizeClientVersion("  10.20.30 ")).toBe("10.20.30");
  });

  it("pads missing segments and falls back when garbage", () => {
    expect(sanitizeClientVersion("7")).toBe("7.0.0");
    expect(sanitizeClientVersion("not-a-version")).toBe("0.2.1");
    expect(sanitizeClientVersion(undefined)).toBe("0.2.1");
  });
});

describe("compareVersions", () => {
  it("orders numerically per segment", () => {
    expect(compareVersions("0.2.1", "0.2.0")).toBe(1);
    expect(compareVersions("0.2.1", "0.2.1")).toBe(0);
    expect(compareVersions("0.9.0", "0.10.0")).toBe(-1);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
  });

  it("flags updates only for strictly newer server builds", () => {
    expect(updateAvailable("0.2.0", "0.2.1")).toBe(true);
    expect(updateAvailable("0.2.1", "0.2.1")).toBe(false);
    expect(updateAvailable("0.2.2", "0.2.1")).toBe(false);
  });

  it("never flags devices that have not reported a version yet", () => {
    expect(updateAvailable("", "0.2.1")).toBe(false);
  });
});

describe("currentClientVersion", () => {
  it("reads PRIVGATE_VERSION from the environment", () => {
    process.env.PRIVGATE_VERSION = "9.8.7";
    expect(currentClientVersion()).toBe("9.8.7");
    delete process.env.PRIVGATE_VERSION;
    expect(currentClientVersion()).toBe("0.2.1");
  });
});
