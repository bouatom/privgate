import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clientBinariesReady, clientBinaryDir } from "./client-binaries";
import { API_BASE_SLOT, TOKEN_SLOT, fitSlot, patchMsiSlots } from "./client-msi-slots";
import { deploymentScript } from "./deployment-script";

const AGENT = "PrivGate.Agent.exe";

describe("client payload discovery and deploy artifacts", () => {
  const dirs: string[] = [];
  const previousClientDir = process.env.PRIVGATE_CLIENT_DIR;

  afterEach(() => {
    if (previousClientDir === undefined) delete process.env.PRIVGATE_CLIENT_DIR;
    else process.env.PRIVGATE_CLIENT_DIR = previousClientDir;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function stageClient(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "privgate-client-"));
    dirs.push(dir);
    writeFileSync(path.join(dir, AGENT), Buffer.from("fake-agent"));
    writeFileSync(path.join(dir, "PrivGate.Helper.exe"), Buffer.from("fake-helper"));
    process.env.PRIVGATE_CLIENT_DIR = dir;
    return dir;
  }

  it("resolves binaries from PRIVGATE_CLIENT_DIR", () => {
    const dir = stageClient();
    expect(clientBinariesReady()).toBe(true);
    expect(clientBinaryDir()).toBe(path.resolve(dir));
  });

  it("embeds client binaries in the PowerShell script", () => {
    stageClient();
    const script = deploymentScript("http://192.168.1.10:3001", "enroll-token-example");
    expect(script).toContain("http://192.168.1.10:3001");
    expect(script).toContain("enroll-token-example");
    expect(script).toContain("PrivGateBroker");
    expect(script).toContain("New-Service");
    expect(script).toContain("FromBase64String");
    expect(script).toContain(AGENT);
    expect(script).not.toContain("/api/agent/bootstrap");
    expect(script).not.toMatch(/application\/zip|\.zip/);
  });

  it("refuses to build a script when the Windows client is missing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "privgate-empty-"));
    dirs.push(dir);
    process.env.PRIVGATE_CLIENT_DIR = dir;
    expect(clientBinariesReady()).toBe(false);
    expect(() => deploymentScript("http://console:3001", "tok")).toThrow(/not on this console/);
  });

  it("brands a packaged MSI by replacing fixed UTF-16 slots", () => {
    const payload = Buffer.concat([
      Buffer.from("MSI"),
      Buffer.from(API_BASE_SLOT, "utf16le"),
      Buffer.from("::"),
      Buffer.from(TOKEN_SLOT, "utf16le"),
    ]);
    const branded = patchMsiSlots(payload, "http://10.0.2.25:3001", "enroll-token");
    expect(branded.includes(Buffer.from(fitSlot(API_BASE_SLOT, "http://10.0.2.25:3001"), "utf16le"))).toBe(
      true,
    );
    expect(branded.includes(Buffer.from(fitSlot(TOKEN_SLOT, "enroll-token"), "utf16le"))).toBe(true);
    expect(API_BASE_SLOT).toHaveLength(256);
    expect(TOKEN_SLOT).toHaveLength(128);
    const cjs = readFileSync(path.resolve(__dirname, "../../packaging/windows/build-client-msi.cjs"), "utf8");
    expect(cjs).toContain("http://privgate-api-base.invalid/");
    expect(cjs).toContain("privgate-enrollment-token.");
  });
});
