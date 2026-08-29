import "server-only";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { applyPaths, parseApplyStatus, readApplyState, UPDATER_START_MARKER } from "./self-update-status";
import { buildUpdaterCommand, resolveUpdaterScript } from "./self-update-command";
import { handoffViaScheduledTask, WINDOWS_UPDATE_TASK, type RunProcess } from "./self-update-handoff";

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

/**
 * If a previous Windows apply downloaded a verified installer but the
 * scheduled task never started (service restart, schtasks hiccup), register
 * and run it again. No-op when the updater already printed its start line,
 * the checksum does not match, or this is not Windows.
 */
export async function resumeInterruptedApply(
  deps: {
    env?: Record<string, string | undefined>;
    now?: () => number;
    platform?: NodeJS.Platform;
    runImpl?: RunProcess;
  } = {},
): Promise<boolean> {
  const platform = deps.platform ?? process.platform;
  if (platform !== "win32") return false;
  const env = deps.env ?? process.env;
  const paths = applyPaths(env);
  const state = readApplyState(paths.stateFile);
  if (!state?.asset || !state.sha256) return false;
  let logText = "";
  try {
    logText = fs.readFileSync(paths.logFile, "utf8");
  } catch {
    logText = "";
  }
  const status = parseApplyStatus({ state, logText, nowMs: (deps.now ?? Date.now)() });
  if (status.phase === "succeeded" || status.phase === "failed" || status.phase === "idle") return false;
  if (UPDATER_START_MARKER.test(logText)) return false;
  const installerPath = path.join(paths.workDir, state.asset);
  if (!fs.existsSync(installerPath)) return false;
  try {
    if ((await fileSha256(installerPath)) !== state.sha256) return false;
  } catch {
    return false;
  }
  const scriptPath = resolveUpdaterScript(process.cwd(), platform);
  if (!scriptPath) return false;
  const command = buildUpdaterCommand({
    platform,
    installerPath,
    scriptPath,
    sha256: state.sha256,
    systemRoot: env.SystemRoot ?? env.windir,
    dataDir: path.dirname(paths.workDir),
  });
  const logFd = fs.openSync(paths.logFile, "a");
  try {
    fs.writeSync(logFd, "==> resume: re-registering scheduled-task handoff\n");
    const handed = await handoffViaScheduledTask({
      xmlPath: path.join(paths.workDir, "update-task.xml"),
      powershell: command.file,
      scriptPath,
      installerPath,
      sha256: state.sha256,
      dataDir: path.dirname(paths.workDir),
      systemRoot: env.SystemRoot ?? env.windir,
      cwd: path.dirname(scriptPath),
      env: { ...env } as NodeJS.ProcessEnv,
      logFd,
      runImpl: deps.runImpl,
    });
    if (!handed.ok) {
      fs.writeSync(logFd, `error: resume handoff failed: ${handed.error}\n`);
      return false;
    }
    fs.writeSync(logFd, `==> handing off to updater via scheduled task ${WINDOWS_UPDATE_TASK}\n`);
    return true;
  } finally {
    try {
      fs.closeSync(logFd);
    } catch {
      /* already closed */
    }
  }
}
