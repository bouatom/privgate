import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * Absolute powershell.exe path — NEVER spawn the bare name. A WinSW service
 * can run with a stripped PATH; CreateProcess then cannot resolve
 * "powershell.exe", the detached updater never starts, and the only trace is
 * the orphaned header line in apply.log (prod incident 10.0.2.25). SystemRoot
 * is always set on Windows; the System32 PowerShell install always exists.
 */
export function resolveWindowsPowershell(systemRoot?: string): string {
  const root = (systemRoot || "C:\\Windows").replace(/[\\/]+$/, "");
  return `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

/** Pure command builder so both platforms are unit-tested without spawning. */
export function buildUpdaterCommand(opts: {
  platform?: string;
  installerPath: string;
  scriptPath: string;
  sha256: string;
  systemRoot?: string;
  dataDir?: string;
}): { file: string; args: string[] } {
  const platform = opts.platform ?? process.platform;
  if (platform === "win32") {
    const args = [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      opts.scriptPath,
      "-Installer",
      opts.installerPath,
      "-Sha256",
      opts.sha256,
    ];
    if (opts.dataDir) {
      args.push("-DataDir", opts.dataDir);
    }
    return {
      file: resolveWindowsPowershell(opts.systemRoot),
      args,
    };
  }
  const flag = path.extname(opts.installerPath).toLowerCase() === ".deb" ? "--deb" : "--pkg";
  return { file: "bash", args: [opts.scriptPath, flag, opts.installerPath, "--sha256", opts.sha256] };
}

/**
 * Locate the updater script shipped inside the installed payload (next to
 * host.cjs), falling back to the repo checkout for dev runs.
 */
export function resolveUpdaterScript(cwd: string = process.cwd(), platform: string = process.platform): string | null {
  const name = platform === "win32" ? "update-server.ps1" : "update-server.sh";
  for (const candidate of [path.join(cwd, name), path.join(cwd, "scripts", name)]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}
