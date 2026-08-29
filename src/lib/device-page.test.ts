import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  resetDbForTests,
  deviceDetail,
  listDeviceSummaries,
  enrollDevice,
  registerOrReuseDevice,
} from "./db";
import { safeApiBase } from "./device-installer";
import { evaluateForDevice } from "./evaluate";

describe("device events and installer", () => {
  it("summarizes the seeded lab device with its pending request and enroll event", () => {
    const db = resetDbForTests(":memory:");
    const rows = listDeviceSummaries(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hostname).toBe("LAB-W11-01");
    expect(rows[0]?.pendingRequests).toBe(1);
    expect(rows[0]?.lastAction).toBe("device.enroll");

    const detail = deviceDetail(db, "dev-lab-01");
    expect(detail?.events.some((e) => e.action === "device.enroll")).toBe(true);
    expect(detail?.requests[0]?.filePath).toContain("Update.exe");
    expect(detail?.uacPrompts).toEqual([]);
  });

  it("keeps the Windows client project next to the console", () => {
    expect(existsSync(`${process.cwd()}/agent`)).toBe(true);
  });

  it("records programs this device was not allowed to elevate", () => {
    const db = resetDbForTests(":memory:");
    const deny = evaluateForDevice(db, "dev-lab-01", {
      userSid: "S-1-5-21-1000-1000-1000-1101",
      filePath: "C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe",
      fileHash: createHash("sha256").update("ps-log").digest("hex"),
      publisher: "CN=Microsoft Windows",
    });
    expect(deny.decision).toBe("deny");
    const detail = deviceDetail(db, "dev-lab-01");
    const blocked = detail?.requests.find((row) => row.status === "denied" && row.filePath.toLowerCase().includes("powershell"));
    expect(blocked?.publisher).toBe("CN=Microsoft Windows");
    expect(blocked?.fileHash).toHaveLength(64);
  });

  it("rejects non-http control plane URLs", () => {
    expect(safeApiBase("javascript:alert(1)", "http://localhost:3000")).toBe("http://localhost:3000");
    expect(safeApiBase("https://privgate.example:8443/extra", "http://localhost:3000")).toBe(
      "https://privgate.example:8443",
    );
  });

  it("registers a PC by hostname and reuses it on reinstall", () => {
    const db = resetDbForTests(":memory:");
    const first = registerOrReuseDevice(db, "FINANCE-W11", "unknown", "dev-device-secret-key-32bytes!!");
    const second = registerOrReuseDevice(db, "finance-w11", "ad", "dev-device-secret-key-32bytes!!");
    expect(second.id).toBe(first.id);
    expect(second.reused).toBe(true);
    expect(listDeviceSummaries(db).map((d) => d.hostname)).toEqual(["FINANCE-W11", "LAB-W11-01"]);
  });

  it("enrolls a second device into the summary list", () => {
    const db = resetDbForTests(":memory:");
    enrollDevice(db, "FINANCE-W11", "unknown", "dev-device-secret-key-32bytes!!");
    expect(listDeviceSummaries(db).map((d) => d.hostname)).toEqual(["FINANCE-W11", "LAB-W11-01"]);
  });
});
