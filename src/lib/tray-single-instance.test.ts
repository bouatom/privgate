import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The logon tray is started twice on purpose (HKLM Run + service SessionLogon).
 * That is only safe if the second process cannot also create a NotifyIcon.
 */
function mutexAllowsTwoOwners(initiallyOwned: boolean, treatCreatedNewAsAcquired: boolean): boolean {
  // createdNew with an unowned mutex is not ownership: a peer WaitOne(0) succeeds.
  return !initiallyOwned && treatCreatedNewAsAcquired;
}

describe("one PrivGate tray per session", () => {
  it("does not treat creating an unowned mutex as already owning it", () => {
    expect(mutexAllowsTwoOwners(false, true)).toBe(true);
    expect(mutexAllowsTwoOwners(true, true)).toBe(false);
  });

  it("is how Program.cs and TraySessions.cs behave", () => {
    const program = readFileSync(join(__dirname, "../../agent/Program.cs"), "utf8");
    expect(program).toContain("initiallyOwned: true");
    expect(program).not.toContain("initiallyOwned: false");
    expect(program).not.toMatch(/var acquired = createdNew/);
    expect(program).toContain("WaitOne(TimeSpan.Zero)");
    const sessions = readFileSync(join(__dirname, "../../agent/TraySessions.cs"), "utf8");
    expect(sessions).toContain("ReapDuplicates");
    expect(sessions).toContain("CountInSession");
    expect(sessions).toContain("tray duplicate killed");
    expect(sessions).toContain("WatchAsync");
  });
});
