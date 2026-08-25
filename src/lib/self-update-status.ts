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
  /^error:\s/i,
  /^update-server:\s/m,
  /checksum mismatch/i,
  /did not become healthy/i,
];

export function parseApplyStatus(
  input: { state: ApplyState | null; logText: string; nowMs: number },
): { phase: ApplyPhase; target: string | null; startedAt: string | null; lastLines: string[] } {
  const lastLines = input.logText
    ? input.logText.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean).slice(-15)
    : [];
  if (!input.state) return { phase: "idle", target: null, startedAt: null, lastLines };

  const succeeded = /update complete\./i.test(input.logText);
  const failed = !succeeded && FAILURE_MARKERS.some((re) => re.test(input.logText));
  const startedMs = Date.parse(input.state.startedAt);
  const ageOk = Number.isFinite(startedMs) && input.nowMs - startedMs <= APPLY_STALE_MS;

  let phase: ApplyPhase;
  if (succeeded) phase = "succeeded";
  else if (failed) phase = "failed";
  else if (!ageOk) phase = "stale";
  else phase = "running";

  return { phase, target: input.state.target, startedAt: input.state.startedAt, lastLines };
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
