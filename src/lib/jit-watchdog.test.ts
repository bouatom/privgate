import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Mirrors agent/JitWatchdog.cs fail-closed local state. */
function tick(statePath: string, nowUnix: number): boolean {
  const raw = readFileSync(statePath, "utf8");
  const state = JSON.parse(raw) as { exp: number };
  return nowUnix >= state.exp;
}

describe("JIT local revoke contract", () => {
  it("revokes when local expiry has passed even without the API", () => {
    const dir = mkdtempSync(join(tmpdir(), "privgate-"));
    const file = join(dir, "jit-revoke.json");
    writeFileSync(file, JSON.stringify({ grantId: "g1", userSid: "S-1-5-21-1", exp: 100 }));
    expect(tick(file, 99)).toBe(false);
    expect(tick(file, 100)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("prefixes Windows SIDs so net localgroup can add the user", () => {
    const src = readFileSync(join(__dirname, "../../agent/JitWatchdog.cs"), "utf8");
    expect(src).toContain("MemberSpec");
    expect(src).toContain('"*" + value');
    expect(src).toContain("localgroup Administrators");
  });
});
