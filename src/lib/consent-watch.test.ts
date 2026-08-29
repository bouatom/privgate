import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Mirrors agent/ConsentWatch.cs: prompt only after UAC has left the session. */
function shouldPrompt(state: { uacWasVisible: boolean }, sessionConsentPids: number[]): boolean {
  if (sessionConsentPids.length > 0) {
    state.uacWasVisible = true;
    return false;
  }
  if (!state.uacWasVisible) return false;
  state.uacWasVisible = false;
  return true;
}

describe("UAC consent watch", () => {
  it("does not prompt while consent.exe is running or when UAC never appeared", () => {
    const state = { uacWasVisible: false };
    expect(shouldPrompt(state, [])).toBe(false);
    expect(shouldPrompt(state, [42])).toBe(false);
    expect(shouldPrompt(state, [42, 43])).toBe(false);
  });

  it("prompts once after the last consent.exe in the session exits", () => {
    const state = { uacWasVisible: false };
    expect(shouldPrompt(state, [7])).toBe(false);
    expect(shouldPrompt(state, [])).toBe(true);
    expect(shouldPrompt(state, [])).toBe(false);
    expect(shouldPrompt(state, [8])).toBe(false);
    expect(shouldPrompt(state, [])).toBe(true);
  });

  it("waits until consent.exe is gone so the offer is not on the secure desktop", () => {
    const src = readFileSync(join(__dirname, "../../agent/ConsentWatch.cs"), "utf8");
    expect(src).toContain("Does not read, hook");
    expect(src).toContain("sessionConsentPids.Count > 0");
    expect(src).toContain("_uacWasVisible = false");
    const prompt = readFileSync(join(__dirname, "../../agent/ElevationPrompt.cs"), "utf8");
    expect(prompt).toContain("TickConsent");
    expect(prompt).toContain("Watch.ShouldPrompt");
    expect(prompt).toContain("Which program did you try to open?");
    expect(prompt).toContain("UacOffer.ShouldAsk");
    expect(readFileSync(join(__dirname, "../../agent/ConsentBrokerWatch.cs"), "utf8")).toContain(
      "consent watch running (broker)",
    );
  });
});
