import { describe, expect, it } from "vitest";
import { listDeviceSummaries, resetDbForTests, saveNotificationSettings, setDeviceAgentVersion } from "./db";
import { dashboardStats } from "./metrics";
import { parseRecipients, shouldNotify } from "./notify";

describe("dashboard metrics", () => {
  it("counts seeded approvals, denials, and pending requests", () => {
    const db = resetDbForTests(":memory:");
    const stats = dashboardStats(db);
    expect(stats.pending).toBe(1);
    expect(stats.approved).toBe(1);
    expect(stats.denied).toBe(1);
    expect(stats.devices).toBe(1);
    expect(stats.policies).toBe(1);
    expect(stats.highRiskPending).toBe(0);
    expect(stats.recent[0]?.status).toBe("pending");
    expect(stats.medianMinutesToDecision).not.toBeNull();
  });

  it("counts failed agent updates from +stale markers and stuck +pending builds", () => {
    const db = resetDbForTests(":memory:");
    const deviceId = listDeviceSummaries(db)[0]!.id;
    const stats = () => dashboardStats(db);

    expect(stats().failedUpdates).toBe(0);

    setDeviceAgentVersion(db, deviceId, "0.2.0+stale@1720000000000");
    expect(stats().failedUpdates).toBe(1);

    // A pending push older than the server's 30-minute stale window counts as failed.
    setDeviceAgentVersion(db, deviceId, `0.3.0+pending@${Date.now() - 31 * 60_000}`);
    expect(stats().failedUpdates).toBe(1);

    // A fresh pending push is still in flight.
    setDeviceAgentVersion(db, deviceId, `0.3.0+pending@${Date.now() - 5 * 60_000}`);
    expect(stats().failedUpdates).toBe(0);

    // A confirmed plain version is healthy.
    setDeviceAgentVersion(db, deviceId, "0.3.0");
    expect(stats().failedUpdates).toBe(0);
  });
});

describe("notification policy", () => {
  it("parses recipient lists and honors critical-only pending", () => {
    const db = resetDbForTests(":memory:");
    saveNotificationSettings(db, { emailEnabled: true, recipients: "ada@contoso.test" });
    const settings = {
      emailEnabled: true,
      webhookEnabled: false,
      onPending: true,
      onApproved: true,
      onDenied: true,
      onJit: true,
      criticalOnly: true,
    };
    expect(parseRecipients("ada@contoso.test, secops@contoso.test")).toEqual([
      "ada@contoso.test",
      "secops@contoso.test",
    ]);
    expect(
      shouldNotify({ ...settings, smtpHost: "", smtpPort: 587, smtpSecure: false, smtpUser: "", smtpFrom: "", recipients: "", passwordSet: false, webhookUrl: "" }, {
        kind: "pending",
        title: "t",
        body: "b",
        riskLevel: "low",
      }),
    ).toBe(false);
    expect(
      shouldNotify({ ...settings, smtpHost: "", smtpPort: 587, smtpSecure: false, smtpUser: "", smtpFrom: "", recipients: "", passwordSet: false, webhookUrl: "" }, {
        kind: "pending",
        title: "t",
        body: "b",
        riskLevel: "critical",
      }),
    ).toBe(true);
  });
});
