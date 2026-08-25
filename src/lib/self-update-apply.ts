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

/**
 * Self-update APPLY flow (one click).
 *
 *   verify sums → download asset → re-verify sha256 → respond 202 →
 *   spawn the platform updater DETACHED → web process dies mid-apply →
 *   updater stops the service, swaps files, starts it again, health-checks.
 *
 * The web process is a casualty by design: the updater's whole job is to stop
 * it. State therefore lives on DISK (see self-update-status.ts), never in
 * memory, so GET /api/configuration/update/status reconstructs progress after
 * the old process is gone and the new one has taken over.
 *
 * Fail closed: nothing is spawned until the downloaded artifact matches the
 * release's sha256sums.txt entry. A missing sums file aborts the apply too.
 */

const DOWNLOAD_CAP_BYTES = 600 * 1024 * 1024;

/** Pure command builder so both platforms are unit-tested without spawning. */
export function buildUpdaterCommand(opts: {
  platform?: string;
  installerPath: string;
  scriptPath: string;
  sha256: string;
}): { file: string; args: string[] } {
  const platform = opts.platform ?? process.platform;
  if (platform === "win32") {
    return {
      file: "powershell.exe",
      args: [
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
      ],
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

async function streamToFile(url: string, destPath: string, fetchImpl: FetchLike): Promise<void> {
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

type SpawnLike = (file: string, args: string[], options: Record<string, unknown>) => { unref: () => void };
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

/**
 * Run pre-checks, then hand off to the detached updater. Returns as soon as
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
  let verifiedSha256 = "";

  try {
    await streamToFile(deps.candidate.url, installerPath, deps.fetchImpl ?? fetch);
    await streamToFile(deps.candidate.sumsUrl, sumsPath, deps.fetchImpl ?? fetch);

    // Fail closed BEFORE anything is touched.
    const expected = parseSha256Sums(await fsp.readFile(sumsPath, "utf8")).get(deps.candidate.assetName);
    if (!expected) throw new Error("sha256sums.txt has no entry for the chosen asset");
    const actual = await fileSha256(installerPath);
    verifiedSha256 = actual;
    if (actual !== expected.toLowerCase()) {
      throw new Error(`checksum mismatch: expected ${expected.toLowerCase()}, got ${actual}`);
    }
  } catch (error) {
    await fsp.rm(installerPath, { force: true }).catch(() => {});
    await fsp.rm(sumsPath, { force: true }).catch(() => {});
    return {
      ok: false,
      status: 502,
      error: `Verification failed, nothing was changed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const scriptPath = resolveUpdaterScript(process.cwd());
  if (!scriptPath) {
    return { ok: false, status: 500, error: "update-server script not found in this installation." };
  }

  const command = buildUpdaterCommand({
    platform: process.platform,
    installerPath,
    scriptPath,
    sha256: verifiedSha256,
  });

  if (deps.db) {
    appendAudit(deps.db, deps.actor, "console.update.apply", deps.candidate.version, {
      channel: deps.candidate.channel,
      asset: deps.candidate.assetName,
      prerelease: deps.candidate.prerelease,
    });
  }

  try {
    await fsp.rm(paths.prevLogFile, { force: true });
    await fsp.rename(paths.logFile, paths.prevLogFile).catch(() => {});
    const newState: ApplyState = {
      target: deps.candidate.version,
      asset: deps.candidate.assetName,
      sha256: verifiedSha256,
      startedAt: new Date().toISOString(),
      logFile: paths.logFile,
    };
    await fsp.writeFile(paths.stateFile, JSON.stringify(newState, null, 2));

    const logFd = fs.openSync(paths.logFile, "a");
    fs.writeSync(logFd, `==> PrivGate self-update to ${deps.candidate.version} (${deps.candidate.assetName})\n`);
    const child = (deps.spawnImpl ?? spawnReal)(command.file, command.args, {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
    });
    child.unref();
    fs.closeSync(logFd);
  } catch (error) {
    await fsp.rm(paths.stateFile, { force: true }).catch(() => {});
    return { ok: false, status: 500, error: `Failed to start updater: ${error instanceof Error ? error.message : String(error)}` };
  }

  return { ok: true, target: deps.candidate.version, logFile: paths.logFile };
}

/** Detached on purpose: the child must outlive this process's death. */
function spawnReal(file: string, args: string[], options: Parameters<typeof spawn>[2]) {
  return spawn(file, args, { ...options, shell: false });
}
