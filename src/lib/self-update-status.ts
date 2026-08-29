import "server-only";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./bootstrap";

/**
 * Self-update APPLY STATE on disk: paths, state file, and log-tail parsing.
 *
 * Lives apart from the executor (self-update-apply.ts) because the web process
 * that starts an update is killed BY that update; whatever survives must be
 * reconstructible from these files alone. Plain reads, no memory state.
 */

export type ApplyPhase = "idle" | "running" | "stale" | "succeeded" | "failed";

export type ApplyState = {
  target: string;
  asset: string;
  sha256: string;
  startedAt: string;
  logFile: string;
};

export type ApplyPaths = { workDir: string; logFile: string; prevLogFile: string; stateFile: string };

export function applyPaths(env: Record<string, string | undefined> = process.env): ApplyPaths {
  const workDir = path.join(dataDir(env), "updates");
  return {
    workDir,
    logFile: path.join(workDir, "apply.log"),
    prevLogFile: path.join(workDir, "apply.prev.log"),
    stateFile: path.join(workDir, "apply-state.json"),
  };
}

/** A state file older than this without a terminal log marker is stale. */
export const APPLY_STALE_MS = 45 * 60_000;

/**
 * How long a log that shows NO sign the updater ever started stays "running"
 * before it is declared dead. The console writes the header + download lines
 * and then a `==> handing off to updater` line right after handoff; the
 * updater itself must print `==> updater start …` as its very first output.
 * If neither appears within this window the handoff failed silently and waiting
 * out the full APPLY_STALE_MS would only confuse the admin.
 */
export const UPDATER_START_WINDOW_MS = 90_000;

export function readApplyState(stateFile: string): ApplyState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8")) as ApplyState;
    if (typeof parsed?.target !== "string" || typeof parsed?.startedAt !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Terminal markers printed by scripts/update-server.sh and update-server.ps1. */
const FAILURE_MARKERS = [
  // /m so an `error:` line anywhere in the log counts, not just at byte 0.
  /^error:\s/im,
  /^update-server:\s/m,
  /checksum mismatch/i,
  /did not become healthy/i,
];

/** Console side: written by self-update-apply.ts immediately after handoff. */
const HANDOFF_MARKER = /handing off to updater/;
/** Updater side: REQUIRED first line of update-server.ps1/.sh. */
export const UPDATER_START_MARKER = /^==> updater start\b/m;

export type ApplyStatusView = {
  phase: ApplyPhase;
  target: string | null;
  startedAt: string | null;
  lastLines: string[];
  /** Where to look next; always names the log file for non-idle phases. */
  hint: string | null;
  /** True when an admin can clear the lock from the console (no live updater). */
  abandonable: boolean;
};

function buildHint(
  phase: ApplyPhase,
  logFile: string,
  seen: { updaterStarted: boolean; handoffSeen: boolean },
): string | null {
  if (phase === "idle" || phase === "running" || phase === "succeeded") return null;
  const where = logFile ? logFile : "apply.log under the console data directory";
  if (phase === "stale" && !seen.updaterStarted) {
    const detail = seen.handoffSeen
      ? "the updater process was launched but produced no output"
      : "the updater likely never started";
    return (
      `No updater output within ${Math.round(UPDATER_START_WINDOW_MS / 1000)} seconds — ${detail}. ` +
      `Use Abandon stuck update, then click Update again. Log: ${where}`
    );
  }
  return phase === "failed"
    ? `Failure detail: ${where}`
    : `No outcome was logged. Use Abandon stuck update, then click Update again. Log: ${where}`;
}

export function parseApplyStatus(
  input: { state: ApplyState | null; logText: string; nowMs: number },
): ApplyStatusView {
  const lastLines = input.logText
    ? input.logText.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean).slice(-15)
    : [];
  if (!input.state) {
    return { phase: "idle", target: null, startedAt: null, lastLines, hint: null, abandonable: false };
  }

  const succeeded = /update complete\./i.test(input.logText);
  const failed = !succeeded && FAILURE_MARKERS.some((re) => re.test(input.logText));
  const startedMs = Date.parse(input.state.startedAt);
  const ageOk = Number.isFinite(startedMs) && input.nowMs - startedMs <= APPLY_STALE_MS;
  // Only the updater's own required first line proves the child ever ran.
  const updaterStarted = UPDATER_START_MARKER.test(input.logText);
  const handoffSeen = HANDOFF_MARKER.test(input.logText);
  const quietMs = Number.isFinite(startedMs) ? input.nowMs - startedMs : Infinity;
  const noUpdaterOutput =
    !updaterStarted && !succeeded && !failed && quietMs > UPDATER_START_WINDOW_MS;

  let phase: ApplyPhase;
  if (succeeded) phase = "succeeded";
  else if (failed) phase = "failed";
  else if (!ageOk || noUpdaterOutput) phase = "stale";
  else phase = "running";

  const abandonable = phase === "stale" || phase === "failed" || (phase === "running" && !updaterStarted);

  return {
    phase,
    target: input.state.target,
    startedAt: input.state.startedAt,
    lastLines,
    hint: buildHint(phase, input.state.logFile, { updaterStarted, handoffSeen }),
    abandonable,
  };
}

/** Current on-disk apply status — safe to call before any apply ever ran. */
export function currentApplyStatus(env: Record<string, string | undefined> = process.env) {
  const paths = applyPaths(env);
  let logText = "";
  try {
    logText = fs.readFileSync(paths.logFile, "utf8");
  } catch {
    /* no log yet */
  }
  return parseApplyStatus({ state: readApplyState(paths.stateFile), logText, nowMs: Date.now() });
}

/**
 * Clear a stuck apply lock so the admin can click Update again from the
 * console. Refuses when the updater has already printed its start line
 * (killing that mid-install would leave a half-swapped payload).
 */
export function abandonApplyLock(
  env: Record<string, string | undefined> = process.env,
): { ok: true } | { ok: false; status: number; error: string } {
  const paths = applyPaths(env);
  const status = currentApplyStatus(env);
  if (status.phase === "idle") return { ok: true };
  if (!status.abandonable) {
    return {
      ok: false,
      status: 409,
      error:
        status.phase === "succeeded"
          ? "The last update already completed."
          : "The updater is already running on the server. Wait for it to finish or fail.",
    };
  }
  try {
    fs.rmSync(paths.stateFile, { force: true });
  } catch {
    return { ok: false, status: 500, error: "Could not clear the apply lock file." };
  }
  return { ok: true };
}
