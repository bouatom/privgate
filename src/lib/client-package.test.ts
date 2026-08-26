import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PACKAGED_CLIENT_MSI, clientBinariesReady, clientBinaryDir, packagedClientMsiPath } from "./client-binaries";
import { buildClientMsi, clientMsiAvailable } from "./client-msi";
import { API_BASE_SLOT, TOKEN_SLOT, fitSlot, patchMsiSlots } from "./client-msi-slots";
import { deploymentScript } from "./deployment-script";
import { buildInstallerEntries, installScript } from "./device-installer";
import { uninstallScript } from "./client-uninstall";
import { enrollmentToken } from "./enrollment";

const AGENT = "PrivGate.Agent.exe";

describe("client payload discovery and deploy artifacts", () => {
  const dirs: string[] = [];
  const previousClientDir = process.env.PRIVGATE_CLIENT_DIR;

  afterEach(() => {
    if (previousClientDir === undefined) delete process.env.PRIVGATE_CLIENT_DIR;
    else process.env.PRIVGATE_CLIENT_DIR = previousClientDir;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const AGENT_CONFIG = "PrivGate.Agent.exe.config";
  const MINIMAL_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8" /></startup>
  <runtime>
    <assemblyBinding xmlns="urn:schemas-microsoft-com:asm.v1">
      <dependentAssembly>
        <assemblyIdentity name="System.Runtime.CompilerServices.Unsafe" publicKeyToken="b03f5f7f11d50a3a" culture="neutral" />
        <bindingRedirect oldVersion="0.0.0.0-6.0.0.0" newVersion="6.0.0.0" />
      </dependentAssembly>
    </assemblyBinding>
  </runtime>
</configuration>`;

  function stageClient(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "privgate-client-"));
    dirs.push(dir);
    writeFileSync(path.join(dir, AGENT), Buffer.from("fake-agent"));
    writeFileSync(path.join(dir, "PrivGate.Helper.exe"), Buffer.from("fake-helper"));
    // The .exe.config must ship alongside the exe so the CLR can apply the
    // System.Runtime.CompilerServices.Unsafe binding redirect at runtime.
    // Without it, System.Text.Json 8.x throws TypeInitializationException on
    // net48 because System.Memory 4.5.5 references Unsafe 4.0.4.1 while the
    // NuGet DLL is 6.0.0.0.
    writeFileSync(path.join(dir, AGENT_CONFIG), MINIMAL_CONFIG);
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

  it("embeds PrivGate.Agent.exe.config so binding redirects reach Windows", () => {
    stageClient();
    const script = deploymentScript("http://192.168.1.10:3001", "tok");
    // The .exe.config must be in the payload; without it the CLR cannot find
    // System.Runtime.CompilerServices.Unsafe 6.0.0.0 on net48 and the service
    // throws TypeInitializationException before BrokerHost.RunAsync is reached.
    expect(script).toContain(AGENT_CONFIG);
  });

  it("keeps the net48 Unsafe binding redirect in agent App.config", () => {
    const agentCfg = readFileSync(path.resolve(__dirname, "../../agent/App.config"), "utf8");
    const helperCfg = readFileSync(path.resolve(__dirname, "../../agent/helper/App.config"), "utf8");
    for (const cfg of [agentCfg, helperCfg]) {
      expect(cfg).toContain("System.Runtime.CompilerServices.Unsafe");
      expect(cfg).toContain('newVersion="6.0.0.0"');
    }
  });

  it("Install-PrivGate.ps1 copies and requires PrivGate.Agent.exe.config", () => {
    const script = installScript();
    expect(script).toContain(AGENT_CONFIG);
    expect(script).toContain("System.Runtime.CompilerServices.Unsafe");
    expect(script).toMatch(/Get-ChildItem \$Root -File/);
  });

  it("script and zip installs register Apps & Features and ship Uninstall-PrivGate.ps1", () => {
    stageClient();
    const deploy = deploymentScript("http://192.168.1.10:3001", "tok");
    expect(deploy).toContain("Uninstall\\PrivGateClient");
    expect(deploy).toContain("PrivGate Client");
    expect(deploy).toContain("Uninstall-PrivGate.ps1");
    expect(deploy).toContain("QuietUninstallString");
    expect(deploy).toContain("sc.exe delete PrivGateBroker");
    expect(deploy).toContain("CurrentVersion\\Run");
    expect(deploy).toContain("PrivGateTray");
    // Outbound allow for the agent (a restrictive baseline must not block it
    // from dialing the console); Helper.exe is local named pipe only.
    expect(deploy).toContain('netsh advfirewall firewall add rule name="PrivGate Agent" dir=out action=allow');
    expect(deploy).toMatch(/program="\$fwBin"/);

    const zipInstall = installScript();
    expect(zipInstall).toContain("Uninstall\\PrivGateClient");
    expect(zipInstall).toContain("Uninstall-PrivGate.ps1");
    expect(zipInstall).toContain("PrivGateTray");
    expect(zipInstall).toContain('netsh advfirewall firewall add rule name="PrivGate Agent" dir=out action=allow');

    const uninstall = uninstallScript();
    expect(uninstall).toContain("PrivGateBroker");
    expect(uninstall).toContain("PrivGateTray");
    expect(uninstall).toContain("CurrentVersion\\Run");
    expect(uninstall).toContain("SOFTWARE\\PrivGate");
    expect(uninstall).toContain("Uninstall\\PrivGateClient");
    expect(uninstall).toContain("ProgramFiles");
    expect(uninstall).toContain("ProgramData");
    expect(uninstall).not.toContain("/api/");
    // Matching removal of the outbound rule on every uninstall flavor.
    expect(uninstall).toContain('netsh advfirewall firewall delete rule name="PrivGate Agent"');
  });

  it("refuses a device zip whose published exe.config lacks the Unsafe redirect", () => {
    const root = mkdtempSync(path.join(tmpdir(), "privgate-zip-cfg-"));
    dirs.push(root);
    mkdirSync(path.join(root, "dist"));
    writeFileSync(path.join(root, "dist", AGENT), Buffer.from("fake-agent"));
    writeFileSync(
      path.join(root, "dist", AGENT_CONFIG),
      `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8" /></startup>
</configuration>`,
    );
    expect(() =>
      buildInstallerEntries({
        hostname: "PC1",
        deviceId: "d1",
        deviceSecret: "secret",
        apiBase: "http://console:3001",
        ticketSigningKey: "key",
        agentRoot: root,
      }),
    ).toThrow(/binding redirects/);
  });

  it("treats a stub exe.config as not ready", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "privgate-stub-cfg-"));
    dirs.push(dir);
    writeFileSync(path.join(dir, AGENT), Buffer.from("fake-agent"));
    writeFileSync(
      path.join(dir, AGENT_CONFIG),
      `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8" /></startup>
</configuration>`,
    );
    process.env.PRIVGATE_CLIENT_DIR = dir;
    expect(clientBinariesReady()).toBe(false);
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
    expect(cjs).toContain("PrivGateTray");
    // Both client MSI flavors must ship the outbound firewall helper and its
    // custom actions (wixl has no fire: extension).
    expect(cjs).toContain("firewall-agent.cmd");
    expect(cjs).toContain('Id="AddAgentFirewall" FileKey="filFirewallAgent" ExeCommand="add"');
    expect(cjs).toMatch(/<Custom Action="AddAgentFirewall" After="InstallFiles">NOT REMOVE~="ALL"<\/Custom>/);
    expect(cjs).toMatch(/<Custom Action="RemoveAgentFirewall" Before="InstallValidate">REMOVE~="ALL"<\/Custom>/);
    const msiTs = readFileSync(path.resolve(__dirname, "./client-msi.ts"), "utf8");
    expect(msiTs).toContain("PrivGateTray");
    expect(msiTs).toContain("CurrentVersion\\\\Run");
    expect(msiTs).toContain("firewall-agent.cmd");
    expect(msiTs).toContain('Id="AddAgentFirewall" FileKey="filFirewallAgent" ExeCommand="add"');
    expect(msiTs).toMatch(/<Custom Action="RemoveAgentFirewall" Before="InstallValidate">REMOVE~="ALL"<\/Custom>/);
  });

  it("treats MSI as available only when the packaged file exists", () => {
    stageClient();
    expect(packagedClientMsiPath()).toBeNull();
    expect(clientMsiAvailable()).toBe(false);

    const dir = process.env.PRIVGATE_CLIENT_DIR!;
    writeFileSync(
      path.join(dir, PACKAGED_CLIENT_MSI),
      Buffer.concat([
        Buffer.from("MSI"),
        Buffer.from(API_BASE_SLOT, "utf16le"),
        Buffer.from("::"),
        Buffer.from(TOKEN_SLOT, "utf16le"),
      ]),
    );
    expect(clientMsiAvailable()).toBe(true);
    expect(packagedClientMsiPath()).toBe(path.join(path.resolve(dir), PACKAGED_CLIENT_MSI));
  });

  it("brands the packaged MSI without compiling WiX at runtime", () => {
    const dir = stageClient();
    writeFileSync(
      path.join(dir, PACKAGED_CLIENT_MSI),
      Buffer.concat([
        Buffer.from("MSI"),
        Buffer.from(API_BASE_SLOT, "utf16le"),
        Buffer.from("::"),
        Buffer.from(TOKEN_SLOT, "utf16le"),
      ]),
    );
    const branded = buildClientMsi("http://10.0.2.25:3001");
    expect(branded.includes(Buffer.from(fitSlot(API_BASE_SLOT, "http://10.0.2.25:3001"), "utf16le"))).toBe(true);
    expect(branded.includes(Buffer.from(fitSlot(TOKEN_SLOT, enrollmentToken()), "utf16le"))).toBe(true);
  });
});
