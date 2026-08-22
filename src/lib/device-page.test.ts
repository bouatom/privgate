import { describe, expect, it } from "vitest";
import { resetDbForTests, deviceDetail, listDeviceSummaries, enrollDevice } from "./db";
import { buildInstallerEntries, installScript, safeApiBase } from "./device-installer";
import { zipBuffers } from "./zip";

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
  });

  it("packages a zip installer with device credentials and install script", () => {
    const entries = buildInstallerEntries({
      hostname: "LAB-W11-01",
      deviceId: "dev-lab-01",
      deviceSecret: "lab-device-secret-do-not-use-in-prod",
      apiBase: "http://192.168.1.10:3000",
      ticketSigningKey: "dev-only-ticket-hmac-key-change",
      agentRoot: `${process.cwd()}/agent`,
    });
    expect(entries.some((e) => e.name === "Install-PrivGate.ps1")).toBe(true);
    const settings = entries.find((e) => e.name === "appsettings.json")?.data.toString();
    expect(settings).toContain("dev-lab-01");
    expect(settings).toContain("192.168.1.10");
    expect(entries.some((e) => e.name === "agent/Program.cs")).toBe(true);
    expect(installScript()).toContain("PrivGateBroker");

    const zip = zipBuffers(entries);
    expect(zip.subarray(0, 2).toString("utf8")).toBe("PK");
    expect(zip.includes(Buffer.from("Install-PrivGate.ps1"))).toBe(true);
  });

  it("rejects non-http control plane URLs", () => {
    expect(safeApiBase("javascript:alert(1)", "http://localhost:3000")).toBe("http://localhost:3000");
    expect(safeApiBase("https://privgate.example:8443/extra", "http://localhost:3000")).toBe(
      "https://privgate.example:8443",
    );
  });

  it("enrolls a second device into the summary list", () => {
    const db = resetDbForTests(":memory:");
    enrollDevice(db, "FINANCE-W11", "hybrid", "dev-device-secret-key-32bytes!!");
    expect(listDeviceSummaries(db).map((d) => d.hostname)).toEqual(["FINANCE-W11", "LAB-W11-01"]);
  });
});
