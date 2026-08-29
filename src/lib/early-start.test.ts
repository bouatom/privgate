import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const agent = (name: string) => readFileSync(join(__dirname, "../../agent", name), "utf8");

describe("early logon UAC capture", () => {
  it("records consent.exe from the broker without waiting for the tray", () => {
    const watch = agent("ConsentBrokerWatch.cs");
    expect(watch).toContain("GetProcessesByName(\"consent\")");
    expect(watch).toContain("ReportUacSeenAsync");
    expect(watch).toContain("HasTray");
    expect(watch).toContain("Does not hook");
    expect(agent("ConsentBrokerWatch.cs")).toContain("consent seen pid=");
    expect(agent("ConsentBrokerWatch.cs")).toContain("recorded");
    expect(agent("ConsentBrokerWatch.cs")).toContain("lock (Gate)");
    expect(agent("ApiClient.cs")).toContain("/api/agent/uac-seen");
    expect(agent("UacTargetExtract.cs")).toContain("FromSession");
  });

  it("starts the session tray at SessionLogon and retries instead of waiting on HKLM Run", () => {
    const sessions = agent("TraySessions.cs");
    expect(sessions).toContain("WatchAsync");
    expect(sessions).toContain("lock (Gate)");
    expect(sessions).toContain("Explorer delays");
    expect(agent("BrokerService.cs")).toContain("Task.Delay(ms)");
    expect(agent("BrokerHost.cs")).toContain("TraySessions.WatchAsync");
    expect(agent("TokenPrivileges.cs")).toContain("SeTcbPrivilege");
    expect(agent("SessionLaunch.cs")).toContain("TokenPrivileges.EnableForService");
    expect(agent("SessionLaunch.cs")).toContain("DetachedProcess");
  });

  it("echoes already-cached consent targets so a late tray still learns the program", () => {
    expect(agent("UacTargetCache.cs")).toContain("TryGetValue(pid, out var existing)");
    expect(agent("AgentTray.cs")).toContain("ElevationPrompt.TickConsent()");
  });
});
