import "server-only";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const AGENT_EXE = "PrivGate.Agent.exe";
export const AGENT_CONFIG = "PrivGate.Agent.exe.config";
export const HELPER_EXE = "PrivGate.Helper.exe";
export const PACKAGED_CLIENT_MSI = "PrivGate-Client.msi";

const UNSAFE_REDIRECT = "System.Runtime.CompilerServices.Unsafe";

const SKIP_PAYLOAD = /\.(msi|wxs|pdb|xml|nupkg)$/i;

function candidateDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.PRIVGATE_CLIENT_DIR) return [env.PRIVGATE_CLIENT_DIR];
  const dirs: string[] = [];
  if (env.PRIVGATE_APP_DIR) dirs.push(path.join(env.PRIVGATE_APP_DIR, "agent", "dist"));
  dirs.push(path.join(process.cwd(), "agent", "dist"));
  return dirs;
}

export function clientBinaryDir(env: NodeJS.ProcessEnv = process.env): string {
  for (const dir of candidateDirs(env)) {
    const resolved = path.resolve(dir);
    if (existsSync(path.join(resolved, AGENT_EXE))) return resolved;
  }
  return path.resolve(candidateDirs(env)[candidateDirs(env).length - 1]!);
}

export function listClientBinaries(env: NodeJS.ProcessEnv = process.env): string[] {
  const dir = clientBinaryDir(env);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => {
    if (name.startsWith(".")) return false;
    if (!/^[A-Za-z0-9._-]+$/.test(name)) return false;
    if (SKIP_PAYLOAD.test(name)) return false;
    const abs = path.join(dir, name);
    return existsSync(abs) && statSync(abs).isFile();
  });
}

export function clientBinaryPath(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return null;
  const dir = path.resolve(clientBinaryDir(env));
  const abs = path.resolve(dir, name);
  if (abs !== dir && !abs.startsWith(dir + path.sep)) return null;
  if (!existsSync(abs) || !statSync(abs).isFile()) return null;
  return abs;
}

export function agentConfigHasBindingRedirects(env: NodeJS.ProcessEnv = process.env): boolean {
  const abs = clientBinaryPath(AGENT_CONFIG, env);
  if (!abs) return false;
  return readFileSync(abs, "utf8").includes(UNSAFE_REDIRECT);
}

export function clientBinariesReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(clientBinaryPath(AGENT_EXE, env) && agentConfigHasBindingRedirects(env));
}

export function packagedClientMsiPath(env: NodeJS.ProcessEnv = process.env): string | null {
  return clientBinaryPath(PACKAGED_CLIENT_MSI, env);
}
