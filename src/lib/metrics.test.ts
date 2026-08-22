import { describe, expect, it } from "vitest";
import { resetDbForTests, saveNotificationSettings } from "./db";
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
