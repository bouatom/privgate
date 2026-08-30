import "server-only";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

/**
 * Windows in-console apply cannot spawn the updater as a child of the
 * WinSW service. `service-ctl.cmd stop-all` escalates to `taskkill /F /T`
 * on PrivGateConsole.exe, which kills that entire process tree — including a
 * PowerShell child, whether or not Node used `detached`. A one-shot
 * Scheduled Task runs as SYSTEM outside that tree, so stop-all cannot
 * reap it. Unix still uses a detached child (no equivalent job kill).
 */

export const WINDOWS_UPDATE_TASK = "PrivGate-Console-Update";

export type RunProcessResult = { code: number; stderr: string };

export type RunProcess = (
  file: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; logFd?: number },
) => Promise<RunProcessResult>;

export function schtasksPath(systemRoot?: string): string {
  const root = (systemRoot || "C:\\Windows").replace(/[\\/]+$/, "");
  return `${root}\\System32\\schtasks.exe`;
}

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

/**
 * Task Scheduler XML must not declare an encoding: schtasks.exe on Windows
 * Server 2022 (build 20348) rejects `encoding="UTF-8"` with "The task XML is
 * malformed. (1,40)::ERROR: unable to switch the encoding", and a UTF-8 BOM
 * trips "incorrect document syntax" at (1,2). Empirically, UTF-16LE with a
 * BOM and no encoding attribute is accepted by schtasks /Create /XML and is
 * the format Task Scheduler itself emits — use that.
 */
export function writeTaskXml(xmlPath: string, xml: string): void {
  fs.writeFileSync(xmlPath, "\uFEFF" + xml, "utf16le");
}

export function buildWindowsUpdateTaskXml(opts: {
  powershell: string;
  scriptPath: string;
  installerPath: string;
  sha256: string;
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
    "-Installer",
    quoteArg(opts.installerPath),
    "-Sha256",
    opts.sha256,
    "-DataDir",
    quoteArg(opts.dataDir),
  ].join(" ");
  const workDir = path.win32.dirname(opts.scriptPath);
  return `<?xml version="1.0"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>PrivGate console self-update (one-shot). Deleted by update-server.ps1 when it starts.</Description>
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

export function createUpdateTaskArgs(xmlPath: string): string[] {
  return ["/Create", "/TN", WINDOWS_UPDATE_TASK, "/XML", xmlPath, "/F"];
}

export function runUpdateTaskArgs(): string[] {
  return ["/Run", "/TN", WINDOWS_UPDATE_TASK];
}

export async function runProcess(file: string, args: string[], opts: Parameters<RunProcess>[2]): Promise<RunProcessResult> {
  return new Promise((resolve, reject) => {
    // Always pipe both streams: schtasks writes its error text to *stdout*;
    // capture everything so the caller's error message carries the real reason
    // instead of a bare "exited 1". Captured output is flushed to logFd after
    // completion (these calls are short-lived).
    const child = spawn(file, args, {
      shell: false,
      windowsHide: true,
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let combined = "";
    const sink = (chunk: Buffer) => {
      combined += chunk.toString("utf8");
    };
    child.stdout?.on("data", sink);
    child.stderr?.on("data", sink);
    child.on("error", reject);
    child.on("close", (code) => {
      if (typeof opts.logFd === "number") {
        try {
          fs.writeSync(opts.logFd, combined);
        } catch {
          // Log desync is non-fatal; the error message still carries the output.
        }
      }
      resolve({ code: code ?? 1, stderr: combined });
    });
  });
}

export async function handoffViaScheduledTask(opts: {
  xmlPath: string;
  powershell: string;
  scriptPath: string;
  installerPath: string;
  sha256: string;
  dataDir: string;
  systemRoot?: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  logFd: number;
  runImpl?: RunProcess;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const xml = buildWindowsUpdateTaskXml({
    powershell: opts.powershell,
    scriptPath: opts.scriptPath,
    installerPath: opts.installerPath,
    sha256: opts.sha256,
    dataDir: opts.dataDir,
  });
  writeTaskXml(opts.xmlPath, xml);
  const schtasks = schtasksPath(opts.systemRoot);
  const run = opts.runImpl ?? runProcess;
  const created = await run(schtasks, createUpdateTaskArgs(opts.xmlPath), {
    cwd: opts.cwd,
    env: opts.env,
    logFd: opts.logFd,
  });
  if (created.code !== 0) {
    return { ok: false, error: `schtasks /Create exited ${created.code}${created.stderr ? `: ${created.stderr.trim()}` : ""}` };
  }
  const started = await run(schtasks, runUpdateTaskArgs(), {
    cwd: opts.cwd,
    env: opts.env,
    logFd: opts.logFd,
  });
  if (started.code !== 0) {
    return { ok: false, error: `schtasks /Run exited ${started.code}${started.stderr ? `: ${started.stderr.trim()}` : ""}` };
  }
  return { ok: true };
}
