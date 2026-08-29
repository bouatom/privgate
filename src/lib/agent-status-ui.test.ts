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
    expect(agent("AgentStatusForm.cs")).toContain("AgentChrome.Apply");
    expect(agent("AgentStatusForm.cs")).toContain("JIT ADMIN");
  });

  it("sections System (communication, version, update) and Requests", () => {
    const status = agent("AgentStatusForm.cs");
    expect(status).toContain("ShowTab");
    expect(status).toContain("AgentSystemPage");
    expect(status).toContain("AgentRequestsPage");
    const system = agent("AgentSystemPage.cs");
    expect(system).toContain("Check for updates");
    expect(system).toContain("Agent version");
    expect(system).toContain("Communication");
    expect(system).toContain("Connected to the management console");
    const requests = agent("AgentRequestsPage.cs");
    expect(requests).toContain("Current");
    expect(requests).toContain("Past");
  });
});
