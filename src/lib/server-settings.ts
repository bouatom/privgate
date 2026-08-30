import "server-only";

/**
 * Server & network apply target: the bind address and port pair the console
 * listens on. Pure types + validation — no I/O, so both the API route and the
 * restart scripts share one contract.
 */

export type ServerSettingsTarget = {
  bind: string;
  webPort: number;
  agentPort: number;
};

const BIND_MAX_LENGTH = 253;

export type ServerTargetParseResult =
  | { ok: true; target: ServerSettingsTarget }
  | { ok: false; error: string };

function parsePort(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
  return n;
}

/**
 * Validate a submitted target. Binds are free-form (an interface address, a
 * wildcard, or a hostname) but must be a single non-empty token; ports must be
 * integers in 1..65535. An agentPort equal to the webPort is legal (single
 * listening port for both console and broker).
 */
export function parseServerTarget(raw: unknown): ServerTargetParseResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "Missing server settings." };
  }
  const record = raw as Record<string, unknown>;
  const bind = typeof record.bind === "string" ? record.bind.trim() : "";
  if (!bind) return { ok: false, error: "Bind address is required." };
  if (bind.length > BIND_MAX_LENGTH || /\s/.test(bind)) {
    return { ok: false, error: "Bind address must be a single address or hostname." };
  }
  const webPort = parsePort(record.webPort);
  if (webPort === null) return { ok: false, error: "Web port must be an integer between 1 and 65535." };
  const agentPort = parsePort(record.agentPort);
  if (agentPort === null) return { ok: false, error: "Broker port must be an integer between 1 and 65535." };
  return { ok: true, target: { bind, webPort, agentPort } };
}

export function serverTargetEquals(a: ServerSettingsTarget, b: ServerSettingsTarget): boolean {
  return a.bind === b.bind && a.webPort === b.webPort && a.agentPort === b.agentPort;
}

/** Compact human label, e.g. "0.0.0.0:3000 (broker 3001)" — for logs/audit. */
export function describeServerTarget(target: ServerSettingsTarget): string {
  const web = `${target.bind}:${target.webPort}`;
  return target.agentPort === target.webPort ? web : `${web} (broker ${target.agentPort})`;
}