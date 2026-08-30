import "server-only";
import fs from "node:fs";
import path from "node:path";
import { runProcess, schtasksPath, type RunProcess } from "./self-update-handoff";

export type { RunProcess };

/**
 * Windows server-settings restart cannot spawn the script as a child of the
 * WinSW service: `service-ctl.cmd stop-all` escalates to `taskkill /F /T` on
 * PrivGateConsole.exe, which kills that entire process tree — the script must
 * survive the very stop it orchestrates. A one-shot Scheduled Task runs as
 * SYSTEM outside that tree (same reasoning as self-update-handoff.ts). Unix
 * still uses a detached child.
 */

export const WINDOWS_SERVER_SETTINGS_TASK = "PrivGate-Server-Settings";

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function quoteArg(value: string): string {
  if (!/[ \t"]/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function buildWindowsServerSettingsTaskXml(opts: {
  powershell: string;
  scriptPath: string;
  bind: string;
  webPort: number;
  agentPort: number;
  dataDir: string;
}): string {
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-WindowStyle",
    "Hidden",
    "-File",
    quoteArg(opts.scriptPath),
    "-Bind",
    quoteArg(opts.bind),
    "-WebPort",
    String(opts.webPort),
    "-AgentPort",
    String(opts.agentPort),
    "-DataDir",
    quoteArg(opts.dataDir),
  ].join(" ");
  const workDir = path.win32.dirname(opts.scriptPath);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>PrivGate console server settings restart (one-shot). Deleted by restart-server.ps1 when it starts.</Description>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <StartBoundary>1999-01-01T00:00:00</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-18</UserId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT20M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlEscape(opts.powershell)}</Command>
      <Arguments>${xmlEscape(args)}</Arguments>
      <WorkingDirectory>${xmlEscape(workDir)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

export function createServerSettingsTaskArgs(xmlPath: string): string[] {
  return ["/Create", "/TN", WINDOWS_SERVER_SETTINGS_TASK, "/XML", xmlPath, "/F"];
}

export function runServerSettingsTaskArgs(): string[] {
  return ["/Run", "/TN", WINDOWS_SERVER_SETTINGS_TASK];
}

export async function handoffServerSettingsViaScheduledTask(opts: {
  xmlPath: string;
  powershell: string;
  scriptPath: string;
  bind: string;
  webPort: number;
  agentPort: number;
  dataDir: string;
  systemRoot?: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  logFd: number;
  runImpl?: RunProcess;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const xml = buildWindowsServerSettingsTaskXml({
    powershell: opts.powershell,
    scriptPath: opts.scriptPath,
    bind: opts.bind,
    webPort: opts.webPort,
    agentPort: opts.agentPort,
    dataDir: opts.dataDir,
  });
  fs.writeFileSync(opts.xmlPath, xml, "utf8");
  const schtasks = schtasksPath(opts.systemRoot);
  const run = opts.runImpl ?? runProcess;
  const created = await run(schtasks, createServerSettingsTaskArgs(opts.xmlPath), {
    cwd: opts.cwd,
    env: opts.env,
    logFd: opts.logFd,
  });
  if (created.code !== 0) {
    return { ok: false, error: `schtasks /Create exited ${created.code}${created.stderr ? `: ${created.stderr.trim()}` : ""}` };
  }
  const started = await run(schtasks, runServerSettingsTaskArgs(), {
    cwd: opts.cwd,
    env: opts.env,
    logFd: opts.logFd,
  });
  if (started.code !== 0) {
    return { ok: false, error: `schtasks /Run exited ${started.code}${started.stderr ? `: ${started.stderr.trim()}` : ""}` };
  }
  return { ok: true };
}