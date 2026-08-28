/**
 * How the control plane binds to the network.
 *
 *  - `PRIVGATE_BIND` (legacy alias `HOSTNAME`) — listen address. `0.0.0.0` /
 *    `::` reach other computers; `127.0.0.1` is this machine only.
 *  - `PRIVGATE_WEB_PORT` (legacy alias `PORT`) — management console.
 *  - `PRIVGATE_AGENT_PORT` — HMAC API used by enrolled Windows brokers.
 *  - `PRIVGATE_AGENT_ORIGIN` — optional public URL for brokers when it is not
 *    "same host as the browser, other port".
 *
 * Keep env names in sync with `packaging/listen-config.cjs`.
 */

import "server-only";
import os from "node:os";

type Env = Record<string, string | undefined>;

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const WILDCARD = new Set(["0.0.0.0", "::", "[::]"]);

export const DEFAULT_WEB_PORT = 3000;
export const DEFAULT_AGENT_PORT = 3001;
export const DEFAULT_BIND = "0.0.0.0";

export type ListenConfig = {
  bind: string;
  webPort: number;
  agentPort: number;
  splitPorts: boolean;
};

export function parseListenPort(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return fallback;
  return n;
}

export function isLoopbackBind(bind: string): boolean {
  return LOOPBACK.has(bind.trim().toLowerCase());
}

export function isWildcardBind(bind: string): boolean {
  return WILDCARD.has(bind.trim());
}

export function listenConfig(env: Env = process.env): ListenConfig {
  const bind = (env.PRIVGATE_BIND || env.HOSTNAME || DEFAULT_BIND).trim() || DEFAULT_BIND;
  const webPort = parseListenPort(env.PRIVGATE_WEB_PORT || env.PORT, DEFAULT_WEB_PORT);
  const agentPort = parseListenPort(env.PRIVGATE_AGENT_PORT, DEFAULT_AGENT_PORT);
  return { bind, webPort, agentPort, splitPorts: agentPort !== webPort };
}

export function agentOriginFromWebOrigin(webOrigin: string, env: Env = process.env): string {
  const explicit = (env.PRIVGATE_AGENT_ORIGIN || "").trim();
  if (explicit) {
    try {
      return new URL(explicit).origin;
    } catch {
      // Fall through to port rewrite.
    }
  }
  const cfg = listenConfig(env);
  try {
    const url = new URL(webOrigin);
    const current = Number(url.port || (url.protocol === "https:" ? "443" : "80"));
    if (cfg.splitPorts && current === cfg.webPort) {
      url.port = String(cfg.agentPort);
    }
    return url.origin;
  } catch {
    return webOrigin.replace(/\/$/, "");
  }
}

export function advertisedIpv4Addresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const addr of list || []) {
      const family = String(addr.family);
      if (addr.internal) continue;
      if (family !== "IPv4" && family !== "4") continue;
      out.push(addr.address);
    }
  }
  return [...new Set(out)].sort();
}

/**
 * The agent origin the console should bake into installers and update MSIs.
 *
 * This is intentionally derived from the console's OWN configuration, never
 * from an inbound request: an enrolled broker requests the update from
 * whatever ApiBase it happens to hold, so echoing the request origin back can
 * perpetuate a stale/wildcard value (the WS-SOHO-03 `0.0.0.0:3001` loop).
 * Priority: explicit PRIVGATE_AGENT_ORIGIN → PRIVGATE_PUBLIC_ORIGIN rewritten
 * to the agent port → first advertised LAN IPv4 + agent port → bind host →
 * loopback.
 */
export function consoleAgentOrigin(env: Env = process.env): string {
  const explicit = (env.PRIVGATE_AGENT_ORIGIN || "").trim();
  if (explicit) {
    try {
      return new URL(explicit).origin;
    } catch {
      // Fall through to lower-priority derivation.
    }
  }
  const cfg = listenConfig(env);

  const publicOrigin = (env.PRIVGATE_PUBLIC_ORIGIN || "").trim();
  if (publicOrigin) {
    try {
      const url = new URL(publicOrigin);
      url.port = String(cfg.agentPort);
      return url.origin;
    } catch {
      // Fall through.
    }
  }

  if (isWildcardBind(cfg.bind)) {
    const first = advertisedIpv4Addresses()[0];
    if (first) return `http://${first}:${cfg.agentPort}`;
  }
  const host = cfg.bind.trim();
  if (host && host !== "0.0.0.0" && host !== "::" && !isLoopbackBind(host)) {
    const bracketed = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
    return `http://${bracketed}:${cfg.agentPort}`;
  }
  return `http://127.0.0.1:${cfg.agentPort}`;
}

export function advertisedUrls(port: number, bind: string): string[] {
  const urls = [`http://127.0.0.1:${port}`];
  if (isLoopbackBind(bind)) return urls;
  if (isWildcardBind(bind)) {
    for (const ip of advertisedIpv4Addresses()) urls.push(`http://${ip}:${port}`);
  } else {
    const host = bind.includes(":") && !bind.startsWith("[") ? `[${bind}]` : bind;
    urls.push(`http://${host}:${port}`);
  }
  return [...new Set(urls)];
}

export function consoleEnvHint(): string {
  if (process.env.PRIVGATE_DATA_DIR) return `${process.env.PRIVGATE_DATA_DIR}/console.env`;
  switch (process.platform) {
    case "win32":
      return "%ProgramData%\\PrivGate\\console.env";
    case "darwin":
      return "/Library/Application Support/PrivGate/console.env";
    default:
      return "/var/lib/privgate/console.env";
  }
}
