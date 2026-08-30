import "server-only";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { DatabaseSync } from "node:sqlite";
import { appendAudit } from "./db/audit";
import { dataDir } from "./bootstrap";
import { describeServerTarget, type ServerSettingsTarget } from "./server-settings";
import {
  readServerApplyState,
  parseServerApplyStatus,
  serverSettingsPaths,
  type ServerApplyState,
} from "./server-settings-state";
import { buildServerRestartCommand, resolveServerRestartScript } from "./server-settings-command";
import {
  handoffServerSettingsViaScheduledTask,
  WINDOWS_SERVER_SETTINGS_TASK,
  type RunProcess,
} from "./server-settings-handoff";

// Re-export the command builders so the network page and tests can use them.
export { buildServerRestartCommand, resolveServerRestartScript } from "./server-settings-command";

/**
 * Server & network APPLY flow (one click).
 *
 *   validate target → write state → hand off to the restart script (Windows:
 *   SYSTEM scheduled task so `taskkill /T` on the WinSW wrapper cannot kill
 *   it; Unix: detached child) → the script backs up console.env, writes the
 *   three listen keys, restarts the console, health-checks on the NEW port,
 *   and rolls the env file back if the console does not come back healthy.
 *
 * Every step appends `==>` progress lines to
 * <dataDir>/server-settings/apply.log (the web process is a casualty by
 * design; the log is the only witness).
 *
 * Fail closed: the target is validated before anything is written, and a
 * running apply is refused with 409. Secrets in console.env are never
 * touched — write-env.cjs --bind/--web-port/--agent-port upserts only those
 * three keys.
 */

type SpawnLike = (file: string, args: string[], options: Record<string, unknown>) => { pid?: number; unref: () => void };

export type ServerApplyResult =
  | { ok: true; target: string; logFile: string }
  | { ok: false; status: number; error: string };

export type ServerApplyDeps = {
  db?: DatabaseSync | null;
  actor: string;
  target: ServerSettingsTarget;
  spawnImpl?: SpawnLike;
  runImpl?: RunProcess;
  env?: Record<string, string | undefined>;
  now?: () => number;
  platform?: NodeJS.Platform;
};

function logLine(logFd: number, line: string): void {
  try {
    fs.writeSync(logFd, `${line}\n`);
  } catch {
    /* best effort */
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run pre-checks, then hand off to the restart script. Returns as soon as the
 * child is spawned; the caller responds 202.
 */
export async function applyServerSettings(deps: ServerApplyDeps): Promise<ServerApplyResult> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const platform = deps.platform ?? process.platform;
  const paths = serverSettingsPaths(env);

  const existing = readServerApplyState(paths.stateFile);
  if (existing) {
    const status = parseServerApplyStatus({
      state: existing,
      logText: (() => {
        try {
          return fs.readFileSync(existing.logFile || paths.logFile, "utf8");
        } catch {
          return "";
        }
      })(),
      nowMs: now(),
    });
    if (status.phase === "running") {
      return { ok: false, status: 409, error: `A server settings change to ${describeServerTarget(existing.target)} is already running.` };
    }
  }

  await fsp.mkdir(paths.workDir, { recursive: true });

  // Rotate the old logs up front so the header lines land in the SAME file
  // the restart script writes to — one log tells the whole story.
  await fsp.rm(paths.prevLogFile, { force: true });
  await fsp.rename(paths.logFile, paths.prevLogFile).catch(() => {});

  let logFd: number | null = null;
  const closeLog = () => {
    if (logFd !== null) {
      try {
        fs.closeSync(logFd);
      } catch {
        /* already closed */
      }
      logFd = null;
    }
  };

  try {
    logFd = fs.openSync(paths.logFile, "a");
    fs.writeSync(logFd, `==> PrivGate server settings apply: ${describeServerTarget(deps.target)}\n`);
    await fsp.writeFile(
      paths.stateFile,
      JSON.stringify(
        {
          target: deps.target,
          startedAt: new Date().toISOString(),
          logFile: paths.logFile,
        } satisfies ServerApplyState,
        null,
        2,
      ),
    );

    const scriptPath = resolveServerRestartScript(process.cwd(), platform);
    if (!scriptPath) {
      closeLog();
      await fsp.rm(paths.stateFile, { force: true }).catch(() => {});
      if (deps.db) {
        appendAudit(deps.db, deps.actor, "console.server.apply.failed", describeServerTarget(deps.target), {
          reason: "restart-server script not found",
          phase: "script-not-found",
        });
      }
      return { ok: false, status: 500, error: "restart-server script not found in this installation." };
    }

    const command = buildServerRestartCommand({
      platform,
      scriptPath,
      bind: deps.target.bind,
      webPort: deps.target.webPort,
      agentPort: deps.target.agentPort,
      systemRoot: env.SystemRoot ?? env.windir,
      dataDir: dataDir(env),
    });

    if (deps.db) {
      appendAudit(deps.db, deps.actor, "console.server.apply", describeServerTarget(deps.target), {
        bind: deps.target.bind,
        webPort: deps.target.webPort,
        agentPort: deps.target.agentPort,
      });
    }

    const newState: ServerApplyState = {
      target: deps.target,
      startedAt: new Date().toISOString(),
      logFile: paths.logFile,
    };
    await fsp.writeFile(paths.stateFile, JSON.stringify(newState, null, 2));

    if (logFd === null) throw new Error("apply log is not open");
    if (platform === "win32") {
      const handed = await handoffServerSettingsViaScheduledTask({
        xmlPath: path.join(paths.workDir, "restart-task.xml"),
        powershell: command.file,
        scriptPath,
        bind: deps.target.bind,
        webPort: deps.target.webPort,
        agentPort: deps.target.agentPort,
        dataDir: dataDir(env),
        systemRoot: env.SystemRoot ?? env.windir,
        cwd: path.dirname(scriptPath),
        env: { ...env } as NodeJS.ProcessEnv,
        logFd,
        runImpl: deps.runImpl,
      });
      if (!handed.ok) throw new Error(handed.error);
      logLine(logFd, `==> handing off to restart script via scheduled task ${WINDOWS_SERVER_SETTINGS_TASK}`);
    } else {
      // Detach on Unix so the script outlives the web process it stops.
      const child = (deps.spawnImpl ?? spawnReal)(command.file, command.args, {
        detached: true,
        cwd: path.dirname(scriptPath),
        env: { ...env } as NodeJS.ProcessEnv,
        stdio: ["ignore", logFd, logFd],
        windowsHide: true,
      });
      child.unref();
      if (typeof child.pid === "number") {
        logLine(logFd, `==> handing off to restart script (pid ${child.pid})`);
      }
    }
    closeLog();
  } catch (error) {
    closeLog();
    // A header-only log whose script never started is the same undiagnosable
    // artifact shape as the prod incident — remove it with the state.
    await fsp.rm(paths.stateFile, { force: true }).catch(() => {});
    await fsp.rm(paths.logFile, { force: true }).catch(() => {});
    if (deps.db) {
      appendAudit(deps.db, deps.actor, "console.server.apply.failed", describeServerTarget(deps.target), {
        reason: errorMessage(error),
        phase: "spawn-failed",
      });
    }
    return { ok: false, status: 500, error: `Failed to start the restart script: ${errorMessage(error)}` };
  }

  return { ok: true, target: describeServerTarget(deps.target), logFile: paths.logFile };
}

/** Detached on purpose: the child must outlive this process's death. */
function spawnReal(file: string, args: string[], options: Parameters<typeof spawn>[2]) {
  return spawn(file, args, { ...options, shell: false });
}