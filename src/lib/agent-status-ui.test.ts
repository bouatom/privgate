import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const agent = (name: string) =>
  readFileSync(path.resolve(__dirname, `../../agent/${name}`), "utf8");

describe("agent status window", () => {
  it("uses borderless muted chrome instead of the OS title bar", () => {
    const chrome = agent("AgentChrome.cs");
    expect(chrome).toContain("FormBorderStyle.None");
    expect(chrome).toContain("DwmwaUseImmersiveDarkMode");
    expect(chrome).toContain("AppIcon.Create");
    expect(chrome).toContain("PrivGate");
    expect(chrome).toContain("Hide window");
    expect(agent("AgentStatusForm.cs")).toContain("AgentChrome.Apply");
    expect(agent("AgentStatusForm.cs")).toContain("Temporary admin");
  });

  it("sections System (connection, version, update) and Requests", () => {
    const status = agent("AgentStatusForm.cs");
    expect(status).toContain("ShowTab");
    expect(status).toContain("AgentSystemPage");
    expect(status).toContain("AgentRequestsPage");
    expect(status).toContain("BindLive");
    const system = agent("AgentSystemPage.cs");
    expect(system).toContain("Check for updates");
    expect(system).toContain("Agent version");
    expect(system).toContain("Console connection");
    expect(system).toContain("Connected");
    const requests = agent("AgentRequestsPage.cs");
    expect(requests).toContain("Waiting for approval");
    expect(requests).toContain("Recent");
    expect(agent("AgentWidgets.cs")).toContain("DecisionPill");
  });
});
