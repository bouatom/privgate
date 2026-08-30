import "server-only";
import fs from "node:fs";
import path from "node:path";
import { resolveWindowsPowershell } from "./self-update-command";

/**
 * Pure command builder + script resolver for the server-settings restart
 * handoff, mirroring self-update-command.ts. Never invokes anything itself so
 * both platforms are unit-tested without spawning.
 */

export function buildServerRestartCommand(opts: {
  platform?: string;
  scriptPath: string;
  bind: string;
  webPort: number;
  agentPort: number;
  dataDir?: string;
  systemRoot?: string;
}): { file: string; args: string[] } {
  const platform = opts.platform ?? process.platform;
  if (platform === "win32") {
    const args = [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-WindowStyle",
      "Hidden",
      "-File",
      opts.scriptPath,
      "-Bind",
      opts.bind,
      "-WebPort",
      String(opts.webPort),
      "-AgentPort",
      String(opts.agentPort),
    ];
    if (opts.dataDir) args.push("-DataDir", opts.dataDir);
    return { file: resolveWindowsPowershell(opts.systemRoot), args };
  }
  const args = [
    opts.scriptPath,
    "--bind",
    opts.bind,
    "--web-port",
    String(opts.webPort),
    "--agent-port",
    String(opts.agentPort),
  ];
  if (opts.dataDir) args.push("--data-dir", opts.dataDir);
  return { file: "bash", args };
}

/**
 * Locate the restart script shipped inside the installed payload (next to
 * host.cjs), falling back to the repo checkout for dev runs.
 */
export function resolveServerRestartScript(cwd: string = process.cwd(), platform: string = process.platform): string | null {
  const name = platform === "win32" ? "restart-server.ps1" : "restart-server.sh";
  for (const candidate of [path.join(cwd, name), path.join(cwd, "scripts", name)]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}