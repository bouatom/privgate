"use strict";

/**
 * Post-update health check for the PrivGate console. Polls the management
 * web port until it answers with a non-server-error status, reading the
 * bind/port from the platform data directory when no explicit URL is given.
 *
 * Plain CommonJS on purpose — updaters run it with the bundled node.
 */

const fs = require("node:fs");
const path = require("node:path");
const { parseListen } = require("./listen-config.cjs");

const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_INTERVAL_MS = 1000;

function parseEnvFile(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[trimmed.slice(0, eq).trim()] = value;
  }
  return out;
}

function dataDirEnv(dataDir) {
  const env = { ...process.env };
  if (dataDir) {
    const envFile = path.join(dataDir, "console.env");
    if (fs.existsSync(envFile)) {
      Object.assign(env, parseEnvFile(fs.readFileSync(envFile, "utf8")));
    }
  }
  return env;
}

/** Management URL for a bind/port pair; wildcard binds map to 127.0.0.1. */
function healthUrl(bind, webPort) {
  const host = ["0.0.0.0", "::", "[::]", ""].includes(String(bind)) ? "127.0.0.1" : bind;
  return `http://${host}:${webPort}/setup`;
}

/** URL for an installed console, preferring its console.env settings. */
function resolveHealthTarget({ dataDir, url, env } = {}) {
  if (url) return url;
  const merged = dataDirEnv(dataDir);
  const cfg = parseListen({ ...env, ...merged });
  return healthUrl(cfg.bind, cfg.webPort);
}

/**
 * Polls `url` until it answers 2xx–4xx (4xx still proves the HTTP stack is
 * serving) or the timeout expires. fetchImpl is injectable for tests.
 */
async function checkHealth(url, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    intervalMs = DEFAULT_INTERVAL_MS,
    fetchImpl = (...args) => fetch(...args),
    now = Date.now,
  } = options;
  const startedAt = now();
  let lastStatus = 0;
  let lastError = "";

  while (now() - startedAt < timeoutMs) {
    try {
      const response = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(intervalMs) });
      lastStatus = response.status;
      if (response.status < 500) {
        return { ok: true, status: lastStatus, url, elapsedMs: now() - startedAt };
      }
      lastError = `HTTP ${response.status}`;
    } catch (err) {
      lastError = err && err.message ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, Math.max(50, timeoutMs / 10))));
  }
  return { ok: false, status: lastStatus, url, elapsedMs: now() - startedAt, error: lastError || "timeout" };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[token.slice(2)] = "1";
    else {
      out[token.slice(2)] = next;
      i++;
    }
  }
  return out;
}

async function fromCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const target = resolveHealthTarget({
    dataDir: args["data-dir"],
    url: args.url,
    env: process.env,
  });
  process.stdout.write(`PrivGate health check → ${target}\n`);
  const result = await checkHealth(target, {
    timeoutMs: Number(args["timeout-ms"]) || DEFAULT_TIMEOUT_MS,
    intervalMs: Number(args["interval-ms"]) || DEFAULT_INTERVAL_MS,
  });
  if (result.ok) {
    console.log(`healthy: HTTP ${result.status} in ${result.elapsedMs}ms`);
    return 0;
  }
  console.error(`unhealthy after ${result.elapsedMs}ms: ${result.error || `HTTP ${result.status}`}`);
  return 1;
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  DEFAULT_TIMEOUT_MS,
  checkHealth,
  healthUrl,
  parseEnvFile,
  resolveHealthTarget,
};

if (require.main === module) void fromCli().then((code) => process.exit(code));
