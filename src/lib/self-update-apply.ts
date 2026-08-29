import "server-only";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import type { DatabaseSync } from "node:sqlite";
import { appendAudit } from "./db/audit";
import {
  applyPaths,
  parseApplyStatus,
  readApplyState,
  type ApplyState,
} from "./self-update-status";
import { parseSha256Sums, type UpdateCandidate } from "./self-update";
import { buildUpdaterCommand, resolveUpdaterScript } from "./self-update-command";

// Re-export the command builders so existing importers of self-update-apply
// (updates page, tests) keep working unchanged.
export { buildUpdaterCommand, resolveUpdaterScript, resolveWindowsPowershell } from "./self-update-command";

/**
 * Self-update APPLY flow (one click).
 *
 *   verify sums → download asset → re-verify sha256 → respond 202 →
 *   spawn the platform updater DETACHED → web process dies mid-apply →
 *   updater stops the service, swaps files, starts it again, health-checks.
 *
 * Every step appends `==>` progress lines to <dataDir>/updates/apply.log so a
 * silent handoff is diagnosable afterwards (the web process is a casualty by
 * design; the log is the only witness).
 *
 * Fail closed: nothing is spawned until the downloaded artifact matches the
 * release's sha256sums.txt entry. A missing sums file aborts the apply too.
 */

const DOWNLOAD_CAP_BYTES = 600 * 1024 * 1024;

async function streamToFile(url: string, destPath: string, fetchImpl: FetchLike): Promise<number> {
  const res = await fetchImpl(url, { headers: { "User-Agent": "privgate-console-self-update" } });
  if (!res.ok || !res.body) throw new Error(`download failed (HTTP ${res.status})`);
  const source = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
  let total = 0;
  source.on("data", (chunk: Buffer) => {
    total += chunk.length;
    if (total > DOWNLOAD_CAP_BYTES) source.destroy(new Error("download exceeds size cap"));
  });
  await new Promise<void>((resolve, reject) => {
    source.on("error", reject);
    const out = fs.createWriteStream(destPath);
    out.on("error", reject);
    out.on("finish", () => resolve());
    source.pipe(out);
  });
  return total;
}

async function fileSha256(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve());
  });
  return hash.digest("hex");
}

type SpawnLike = (file: string, args: string[], options: Record<string, unknown>) => { pid?: number; unref: () => void };
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type ApplyResult =
  | { ok: true; target: string; logFile: string }
  | { ok: false; status: number; error: string };

export type ApplyDeps = {
  db?: DatabaseSync | null;
  actor: string;
  candidate: UpdateCandidate;
  spawnImpl?: SpawnLike;
  fetchImpl?: FetchLike;
  env?: Record<string, string | undefined>;
  now?: () => number;
};

/** Progress lines share the updater's log fd; logging must never break the apply. */
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
 * Run pre-checks, then hand off to the updater. Returns as soon as
 * the child is spawned; the caller responds 202 and expects the process to be
 * killed by the very child it launched.
 */
export async function applyConsoleUpdate(deps: ApplyDeps): Promise<ApplyResult> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const paths = applyPaths(env);

  if (!deps.candidate.sumsUrl) {
    return { ok: false, status: 502, error: "Release has no sha256sums.txt; refusing to install an unverifiable artifact." };
  }
  const existing = readApplyState(paths.stateFile);
  if (existing) {
    const status = parseApplyStatus({
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
      return { ok: false, status: 409, error: `Update to ${existing.target} is already running.` };
    }
  }

  await fsp.mkdir(paths.workDir, { recursive: true });
  const installerPath = path.join(paths.workDir, deps.candidate.assetName);
  const sumsPath = path.join(paths.workDir, "sha256sums.txt");

  // Rotate the old logs up front so download/verify/handoff lines land in the
  // SAME file the updater writes to — one log tells the whole story.
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
    fs.writeSync(logFd, `==> PrivGate self-update to ${deps.candidate.version} (${deps.candidate.assetName})\n`);
    logLine(logFd, `==> download start ${deps.candidate.url}`);

    let verifiedSha256 = "";
    try {
      const dlStart = Date.now();
      const bytes = await streamToFile(deps.candidate.url, installerPath, deps.fetchImpl ?? fetch);
      const dlMs = Date.now() - dlStart;
      logLine(logFd, `==> downloaded ${bytes} bytes in ${dlMs}ms (${deps.candidate.assetName})`);
      await streamToFile(deps.candidate.sumsUrl, sumsPath, deps.fetchImpl ?? fetch);

      // Fail closed BEFORE anything is touched or executed.
      const expected = parseSha256Sums(await fsp.readFile(sumsPath, "utf8")).get(deps.candidate.assetName);
      if (!expected) throw new Error("sha256sums.txt has no entry for the chosen asset");
      const actual = await fileSha256(installerPath);
      if (actual !== expected.toLowerCase()) {
        throw new Error(`checksum mismatch: expected ${expected.toLowerCase()}, got ${actual}`);
      }
      verifiedSha256 = actual;
      logLine(logFd, `==> sha256 verified ${verifiedSha256}`);
    } catch (error) {
      logLine(logFd, `error: verification failed, nothing was changed: ${errorMessage(error)}`);
      closeLog();
      await fsp.rm(installerPath, { force: true }).catch(() => {});
      await fsp.rm(sumsPath, { force: true }).catch(() => {});
      // A leftover state file from any earlier run must not outlive a failed attempt.
      await fsp.rm(paths.stateFile, { force: true }).catch(() => {});
      if (deps.db) {
        appendAudit(deps.db, deps.actor, "console.update.apply.failed", deps.candidate.version, {
          reason: errorMessage(error),
          phase: "verification",
        });
      }
      return {
        ok: false,
        status: 502,
        error: `Verification failed, nothing was changed: ${errorMessage(error)}`,
      };
    }

    const scriptPath = resolveUpdaterScript(process.cwd());
    if (!scriptPath) {
      closeLog();
      await fsp.rm(paths.stateFile, { force: true }).catch(() => {});
      if (deps.db) {
        appendAudit(deps.db, deps.actor, "console.update.apply.failed", deps.candidate.version, {
          reason: "update-server script not found",
          phase: "updater-not-found",
        });
      }
      return { ok: false, status: 500, error: "update-server script not found in this installation." };
    }

    const command = buildUpdaterCommand({
      platform: process.platform,
      installerPath,
      scriptPath,
      sha256: verifiedSha256,
      systemRoot: env.SystemRoot ?? env.windir,
      dataDir: paths.workDir ? path.dirname(paths.workDir) : undefined,
    });

    if (deps.db) {
      appendAudit(deps.db, deps.actor, "console.update.apply", deps.candidate.version, {
        channel: deps.candidate.channel,
        asset: deps.candidate.assetName,
        prerelease: deps.candidate.prerelease,
      });
    }

    const newState: ApplyState = {
      target: deps.candidate.version,
      asset: deps.candidate.assetName,
      sha256: verifiedSha256,
      startedAt: new Date().toISOString(),
      logFile: paths.logFile,
    };
    await fsp.writeFile(paths.stateFile, JSON.stringify(newState, null, 2));

    // Explicit cwd + full env passthrough: services may run with a minimal
    // default working directory, and the child needs the service environment.
    //
    // Detach on Unix (the updater must outlive the web process it stops), but
    // NEVER on Windows: DETACHED_PROCESS (CREATE_NEW_PROCESS_GROUP) breaks the
    // PowerShell child — it starts but emits nothing and never writes its
    // required "==> updater start" line, so apply.log is left stuck at the
    // handoff marker and status drops to "stale" (proven on prod box 10.0.2.25:
    // identical spawn with detached:false works end-to-end). A Windows parent
    // kill does NOT reap its children, so the updater still survives the
    // console service being stopped mid-apply.
    const child = (deps.spawnImpl ?? spawnReal)(command.file, command.args, {
      detached: process.platform !== "win32",
      cwd: path.dirname(scriptPath),
      env: { ...env } as NodeJS.ProcessEnv,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
    });
    child.unref();
    if (typeof child.pid === "number") {
      logLine(logFd, `==> handing off to updater (pid ${child.pid})`);
    }
    closeLog();
  } catch (error) {
    closeLog();
    // A header-only log whose updater never started is exactly the artifact
    // that made the prod incident undiagnosable — remove it with the state.
    await fsp.rm(paths.stateFile, { force: true }).catch(() => {});
    await fsp.rm(paths.logFile, { force: true }).catch(() => {});
    if (deps.db) {
      appendAudit(deps.db, deps.actor, "console.update.apply.failed", deps.candidate.version, {
        reason: errorMessage(error),
        phase: "spawn-failed",
      });
    }
    return { ok: false, status: 500, error: `Failed to start updater: ${errorMessage(error)}` };
  }

  return { ok: true, target: deps.candidate.version, logFile: paths.logFile };
}

/** Detached on purpose: the child must outlive this process's death. */
function spawnReal(file: string, args: string[], options: Parameters<typeof spawn>[2]) {
  return spawn(file, args, { ...options, shell: false });
}
