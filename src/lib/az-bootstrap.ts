import "server-only";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type AzJob = {
  proc: ChildProcess;
  log: string;
  userCode?: string;
  verificationUri: string;
  finished?: { token?: string; error?: string };
};

const jobs = globalThis as unknown as { __privgateAzJobs?: Map<string, AzJob> };
function registry() {
  jobs.__privgateAzJobs ??= new Map();
  return jobs.__privgateAzJobs;
}

export async function azBinary(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/which", ["az"], { timeout: 5000 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function azGraphToken(): Promise<string | undefined> {
  const az = await azBinary();
  if (!az) return undefined;
  try {
    const { stdout } = await execFileAsync(
      az,
      ["account", "get-access-token", "--resource-type", "ms-graph", "-o", "json"],
      { timeout: 20_000 },
    );
    const json = JSON.parse(stdout) as { accessToken?: string };
    return json.accessToken;
  } catch {
    return undefined;
  }
}

function parseDevicePrompt(log: string): { userCode?: string; verificationUri: string } {
  const code = log.match(/enter the code\s+([A-Z0-9]+)/i)?.[1];
  const uri =
    log.match(/https:\/\/(?:www\.)?microsoft\.com\/devicelogin/i)?.[0] ||
    "https://microsoft.com/devicelogin";
  return { userCode: code?.toUpperCase(), verificationUri: uri };
}

export async function startAzDeviceLogin(state: string): Promise<{
  userCode: string;
  verificationUri: string;
} | { error: string }> {
  const az = await azBinary();
  if (!az) return { error: "Azure CLI is not installed" };
  const existing = registry().get(state);
  if (existing?.userCode) {
    return { userCode: existing.userCode, verificationUri: existing.verificationUri };
  }
  const proc = spawn(az, ["login", "--use-device-code", "--allow-no-subscriptions"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const job: AzJob = { proc, log: "", verificationUri: "https://microsoft.com/devicelogin" };
  registry().set(state, job);

  const onData = (buf: Buffer) => {
    job.log += buf.toString();
    const parsed = parseDevicePrompt(job.log);
    if (parsed.userCode) {
      job.userCode = parsed.userCode;
      job.verificationUri = parsed.verificationUri;
    }
  };
  proc.stdout?.on("data", onData);
  proc.stderr?.on("data", onData);
  proc.on("exit", async (code) => {
    if (code === 0) {
      const token = await azGraphToken();
      job.finished = token ? { token } : { error: "Azure CLI login succeeded but no Graph token was issued" };
    } else {
      job.finished = { error: "Azure CLI login did not complete" };
    }
  });

  const started = Date.now();
  while (!job.userCode && Date.now() - started < 15_000) {
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!job.userCode) {
    proc.kill("SIGTERM");
    registry().delete(state);
    return { error: "Azure CLI did not print a device code" };
  }
  return { userCode: job.userCode, verificationUri: job.verificationUri };
}

export function pollAzDeviceLogin(state: string): { status: "pending" } | { token: string } | { error: string } {
  const job = registry().get(state);
  if (!job) return { error: "Azure CLI login expired. Start Connect Entra again." };
  if (job.finished?.token) {
    registry().delete(state);
    return { token: job.finished.token };
  }
  if (job.finished?.error) {
    registry().delete(state);
    return { error: job.finished.error };
  }
  return { status: "pending" };
}
