import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { agentFirewallCmdContent } from "./client-firewall";

const PACKAGING = path.resolve(__dirname, "../../packaging");

/**
 * Firewall coverage of every installer flavor:
 * - console NSIS: inbound 3000/3001 rules created on install, removed on
 *   uninstall, ports re-synced from console.env on upgrades;
 * - console MSI helper + client MSI helper: netsh via shipped .cmd files
 *   (wixl cannot compile fire:FirewallException);
 * - build.sh must ship the console helper with CRLF endings.
 */
describe("installer firewall rules", () => {
  const nsi = readFileSync(path.join(PACKAGING, "windows/privgate.nsi"), "utf8");
  const consoleCmd = readFileSync(path.join(PACKAGING, "windows/firewall-console.cmd"), "utf8");
  const agentCmdCanonical = readFileSync(path.join(PACKAGING, "windows/firewall-agent.cmd"), "utf8");
  const buildSh = readFileSync(path.join(PACKAGING, "build.sh"), "utf8");

  it("NSIS install opens inbound web + broker ports and removes them on uninstall", () => {
    expect(nsi).toContain('netsh advfirewall firewall add rule name="PrivGate Console (web)"');
    expect(nsi).toMatch(/add rule name="PrivGate Console \(web\)" dir=in action=allow protocol=TCP localport=\$WebPort/);
    expect(nsi).toContain('netsh advfirewall firewall add rule name="PrivGate Agent broker"');
    expect(nsi).toMatch(/add rule name="PrivGate Agent broker" dir=in action=allow protocol=TCP localport=\$AgentPort/);
    // Idempotent delete before each add.
    expect(nsi).toContain('netsh advfirewall firewall delete rule name="PrivGate Console (web)"');
    expect(nsi).toContain('netsh advfirewall firewall delete rule name="PrivGate Agent broker"');
  });

  it("NSIS keeps install alive when the firewall service is missing", () => {
    // The netsh results are logged as warnings; no Abort may sit behind them.
    expect(nsi).toMatch(/WARNING: could not open inbound TCP \$WebPort/);
    expect(nsi).toMatch(/WARNING: could not open inbound TCP \$AgentPort/);
    const installSection = nsi.slice(nsi.indexOf('Section "Install"'), nsi.indexOf("WriteUninstaller"));
    expect(installSection).not.toMatch(/Abort/);
  });

  it("NSIS recovers configured ports from console.env before creating rules", () => {
    // Upgrades skip the network page; without this the rules would fall back
    // to defaults while the service listens elsewhere.
    expect(nsi).toContain("Function SyncFirewallPorts");
    expect(nsi).toContain("Function ReadEnvPort");
    expect(nsi).toContain('Push "PRIVGATE_WEB_PORT"');
    expect(nsi).toContain('Push "PRIVGATE_AGENT_PORT"');
    const syncPos = nsi.indexOf("Call SyncFirewallPorts");
    const writeEnvPos = nsi.indexOf("write-env.cjs");
    const startPos = nsi.indexOf('"$INSTDIR\\service-ctl.cmd" start');
    expect(syncPos).toBeGreaterThan(writeEnvPos);
    expect(syncPos).toBeLessThan(startPos);
  });

  it("console MSI helper adds/removes both named inbound rules with env-driven ports", () => {
    // Rules are created through the :ALLOW_IN helper (name=%1 port=%2).
    expect(consoleCmd).toContain('call :ALLOW_IN "PrivGate Console (web)" %WEBPORT%');
    expect(consoleCmd).toContain('call :ALLOW_IN "PrivGate Agent broker" %AGENTPORT%');
    expect(consoleCmd).toMatch(/add rule name=%1 dir=in action=allow protocol=TCP localport=%2/);
    expect(consoleCmd).toMatch(/delete rule name=%1 >/);
    expect(consoleCmd).toContain('delete rule name="PrivGate Console (web)"');
    expect(consoleCmd).toContain('delete rule name="PrivGate Agent broker"');
    expect(consoleCmd).toContain("PRIVGATE_WEB_PORT");
    expect(consoleCmd).toContain("PRIVGATE_AGENT_PORT");
    expect(consoleCmd).toContain("console.env");
    expect(consoleCmd).toContain('set "WEBPORT=3000"');
    expect(consoleCmd).toContain('set "AGENTPORT=3001"');
  });

  it("client MSI helper matches the embedded TS copy exactly", () => {
    const normalize = (s: string) => s.replace(/\r\n/g, "\n").trimEnd();
    const embedded = agentFirewallCmdContent().replace(/\$\{AGENT_FIREWALL_RULE\}/g, "PrivGate Agent");
    expect(normalize(agentCmdCanonical)).toBe(normalize(embedded));
    expect(embedded).toContain('dir=out action=allow program="%AGENTBIN%" profile=any');
  });

  it("build.sh ships the console helper with CRLF alongside service-ctl.cmd", () => {
    expect(buildSh).toContain(
      'copy_crlf "$ROOT/packaging/windows/firewall-console.cmd" "$STAGE/win/firewall-console.cmd"',
    );
  });
});
