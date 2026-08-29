import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const agent = (name: string) =>
  readFileSync(path.resolve(__dirname, `../../agent/${name}`), "utf8");

describe("Windows agent update and per-user tray", () => {
  it("hands msiexec to a SYSTEM scheduled task, not a child of the broker", () => {
    const handoff = agent("AgentUpdateHandoff.cs");
    expect(handoff).toContain("PrivGate-Agent-Update");
    expect(handoff).toContain("S-1-5-18");
    expect(handoff).toContain("/qn /norestart");
    expect(handoff).toContain("schtasks.exe");
    expect(handoff).toContain("/Create");
    expect(handoff).toContain("/Run");
    const mgr = agent("UpdateManager.cs");
    expect(mgr).toContain("AgentUpdateHandoff.Run");
    expect(mgr).not.toContain("Process.Start(psi)");
  });

  it("does not re-register when DeviceId is already set", () => {
    const host = agent("BrokerHost.cs");
    expect(host).toContain("if (string.IsNullOrWhiteSpace(cfg.DeviceId))");
    expect(host).not.toMatch(
      /IsNullOrWhiteSpace\(cfg\.DeviceId\) \|\| !string\.IsNullOrWhiteSpace\(cfg\.EnrollmentToken\)/,
    );
    const overlay = agent("CfgOverlay.cs");
    expect(overlay).toContain("string.IsNullOrWhiteSpace(cfg.DeviceId) && string.IsNullOrWhiteSpace(cfg.EnrollmentToken)");
    expect(overlay).toContain("PersistIdentity");
  });

  it("keeps the broker in the service and relaunches trays per session as the user", () => {
    const tray = agent("AgentTray.cs");
    expect(tray).toContain("ServiceInstalled()");
    expect(tray).toContain("_ownsBroker = existing == null && !ServiceInstalled()");
    expect(tray).toContain("BrokerStatus.TryQueryPipe()");
    expect(tray).toContain("The service snapshot is the source of truth");
    const svc = agent("BrokerService.cs");
    expect(svc).toContain("CanHandleSessionChangeEvent = true");
    expect(svc).toContain("SessionChangeReason.SessionLogon");
    expect(svc).toContain("TraySessions.EnsureAll");
    expect(agent("TraySessions.cs")).toContain("InSessionAsLoggedOnUser");
    expect(agent("SessionLaunch.cs")).toContain("WTSQueryUserToken");
  });
});
