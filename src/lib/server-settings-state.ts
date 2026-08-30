import "server-only";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./bootstrap";
import type { ServerSettingsTarget } from "./server-settings";

/**
 * Server & network APPLY STATE on disk: paths, state file, and log-tail
 * parsing. Built to the same contract as self-update-status.ts: the apply
 * restarts the console process, so whatever must survive is reconstructed
 * from these files alone. Plain reads, no memory state.
 *
 * Success/failure are inferred from the terminal markers printed by
 * scripts/restart-server.ps1/.sh:
 *   success  → "==> server settings applied."
 *   failure  → "error: <message>" (the script rolls the env file back first)
 *   aborted  → "error: checksum/validation ..." from the apply side
 */

export type ServerApplyPhase = "idle" | "running" | "stale" | "succeeded" | "failed";

export type ServerApplyState = {
  target: ServerSettingsTarget;
  startedAt: string;
  logFile: string;
};

export type ServerApplyPaths = { workDir: string; logFile: string; prevLogFile: string; stateFile: string };

export function serverSettingsPaths(env: Record<string, string | undefined> = process.env): ServerApplyPaths {
  const workDir = path.join(dataDir(env), "server-settings");
  return {
    workDir,
    logFile: path.join(workDir, "apply.log"),
    prevLogFile: path.join(workDir, "apply.prev.log"),
    stateFile: path.join(workDir, "apply-state.json"),
  };
}

/** A state file older than this without a terminal log marker is stale. */
export const SERVER_APPLY_STALE_MS = 45 * 60_000;

/**
 * How long a log showing NO sign the restart script ever started stays
 * "running" before it is declared dead. The console writes the header and a
 * `==> handing off to restart script` line right after handoff; the script
 * itself must print `==> restart-server start …` as its very first output.
 */
export const SERVER_UPDATER_START_WINDOW_MS = 90_000;

export function readServerApplyState(stateFile: string): ServerApplyState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8")) as ServerApplyState;
    if (
      typeof parsed?.target?.bind !== "string" ||
      typeof parsed?.target?.webPort !== "number" ||
      typeof parsed?.target?.agentPort !== "number" ||
      typeof parsed?.startedAt !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Terminal markers printed by scripts/restart-server.sh and restart-server.ps1. */
const FAILURE_MARKERS = [
  /^error:\s/im,
  /^restart-server:\s/m,
  /did not become healthy/i,
  /could not be restored/i,
];

/** Console side: written by server-settings-apply.ts immediately after handoff. */
const HANDOFF_MARKER = /handing off to restart script/;
/** Restart-script side: REQUIRED first line of restart-server.ps1/.sh. */
export const RESTART_SERVER_START_MARKER = /^==> restart-server start\b/m;
/** Success marker: the script applied the settings and the console is healthy. */
export const SERVER_SETTINGS_APPLIED_MARKER = /^==> server settings applied\./im;

export type ServerApplyStatusView = {
  phase: ServerApplyPhase;
  target: ServerSettingsTarget | null;
  startedAt: string | null;
  lastLines: string[];
  /** Where to look next; always names the log file for non-idle phases. */
  hint: string | null;
  /** True when an admin can clear the lock from the console (no live script). */
  abandonable: boolean;
};

function buildHint(
  phase: ServerApplyPhase,
  logFile: string,
  seen: { scriptStarted: boolean; handoffSeen: boolean },
): string | null {
  if (phase === "idle" || phase === "running" || phase === "succeeded") return null;
  const where = logFile ? logFile : "server-settings/apply.log under the console data directory";
  if (phase === "stale" && !seen.scriptStarted) {
    const detail = seen.handoffSeen
      ? "the restart script was launched but produced no output"
      : "the restart script likely never started";
    return (
      `No script output within ${Math.round(SERVER_UPDATER_START_WINDOW_MS / 1000)} seconds — ${detail}. ` +
      `Use Abandon stuck change, then try again. Log: ${where}`
    );
  }
  return phase === "failed"
    ? `Failure detail: ${where}`
    : `No outcome was logged. Use Abandon stuck change, then try again. Log: ${where}`;
}

export function parseServerApplyStatus(
  input: { state: ServerApplyState | null; logText: string; nowMs: number },
): ServerApplyStatusView {
  const lastLines = input.logText
    ? input.logText.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean).slice(-15)
    : [];
  if (!input.state) {
    return { phase: "idle", target: null, startedAt: null, lastLines, hint: null, abandonable: false };
  }

  const succeeded = SERVER_SETTINGS_APPLIED_MARKER.test(input.logText);
  const failed = !succeeded && FAILURE_MARKERS.some((re) => re.test(input.logText));
  const startedMs = Date.parse(input.state.startedAt);
  const ageOk = Number.isFinite(startedMs) && input.nowMs - startedMs <= SERVER_APPLY_STALE_MS;
  // Only the script's own required first line proves the child ever ran.
  const scriptStarted = RESTART_SERVER_START_MARKER.test(input.logText);
  const handoffSeen = HANDOFF_MARKER.test(input.logText);
  const quietMs = Number.isFinite(startedMs) ? input.nowMs - startedMs : Infinity;
  const noScriptOutput = !scriptStarted && !succeeded && !failed && quietMs > SERVER_UPDATER_START_WINDOW_MS;

  let phase: ServerApplyPhase;
  if (succeeded) phase = "succeeded";
  else if (failed) phase = "failed";
  else if (!ageOk || noScriptOutput) phase = "stale";
  else phase = "running";

  const abandonable = phase === "stale" || phase === "failed" || (phase === "running" && !scriptStarted);

  return {
    phase,
    target: input.state.target,
    startedAt: input.state.startedAt,
    lastLines,
    hint: buildHint(phase, input.state.logFile, { scriptStarted, handoffSeen }),
    abandonable,
  };
}

/** Current on-disk apply status — safe to call before any apply ever ran. */
export function currentServerApplyStatus(env: Record<string, string | undefined> = process.env) {
  const paths = serverSettingsPaths(env);
  let logText = "";
  try {
    logText = fs.readFileSync(paths.logFile, "utf8");
  } catch {
    /* no log yet */
  }
  return parseServerApplyStatus({ state: readServerApplyState(paths.stateFile), logText, nowMs: Date.now() });
}

/**
 * Clear a stuck apply lock so the admin can try again. Refuses when the
 * restart script has already printed its start line (killing it mid-restart
 * could leave the console down or half-configured).
 */
export function abandonServerApplyLock(
  env: Record<string, string | undefined> = process.env,
): { ok: true } | { ok: false; status: number; error: string } {
  const paths = serverSettingsPaths(env);
  const status = currentServerApplyStatus(env);
  if (status.phase === "idle") return { ok: true };
  if (!status.abandonable) {
    return {
      ok: false,
      status: 409,
      error:
        status.phase === "succeeded"
          ? "The last change already applied."
          : "A server settings change is already running. Wait for it to finish or fail.",
    };
  }
  try {
    fs.rmSync(paths.stateFile, { force: true });
  } catch {
    return { ok: false, status: 500, error: "Could not clear the apply lock file." };
  }
  return { ok: true };
}