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

/**
 * Endpoints to probe in order: the unauthenticated /healthz liveness route
 * first, then the legacy /setup page for older installs without it.
 */
function healthUrls(bind, webPort) {
  const host = ["0.0.0.0", "::", "[::]", ""].includes(String(bind)) ? "127.0.0.1" : bind;
  return [`http://${host}:${webPort}/healthz`, `http://${host}:${webPort}/setup`];
}

/** URL for an installed console, preferring its console.env settings. */
function resolveHealthTarget({ dataDir, url, env } = {}) {
  if (url) return url;
  const merged = dataDirEnv(dataDir);
  const cfg = parseListen({ ...env, ...merged });
  return healthUrl(cfg.bind, cfg.webPort);
}

/** Same as resolveHealthTarget but returning every endpoint to try, in order. */
function resolveHealthTargets({ dataDir, url, env } = {}) {
  if (url) return [url];
  const merged = dataDirEnv(dataDir);
  const cfg = parseListen({ ...env, ...merged });
  return healthUrls(cfg.bind, cfg.webPort);
}

/**
 * Polls one URL until it answers non-5xx, a definitive 404 ("route missing"),
 * or the absolute `deadline` passes. fetchImpl is injectable for tests.
 */
async function pollEndpoint(url, { deadline, intervalMs = DEFAULT_INTERVAL_MS, fetchImpl, now = Date.now }) {
  const fetch_ = fetchImpl || ((...args) => fetch(...args));
  let lastStatus = 0;
  let lastError = "";
  while (now() < deadline) {
    try {
      const response = await fetch_(url, { redirect: "manual", signal: AbortSignal.timeout(intervalMs) });
      lastStatus = response.status;
      if (response.status === 404) return { ok: false, status: lastStatus, url, missing: true };
      if (response.status < 500) return { ok: true, status: lastStatus, url };
      lastError = `HTTP ${response.status}`;
    } catch (err) {
      lastError = err && err.message ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, Math.max(50, deadline - now()))));
  }
  return { ok: false, status: lastStatus, url, error: lastError || "timeout" };
}

/**
 * Probes [primary, fallback] endpoints within one shared time budget:
 * /healthz answers → healthy; /healthz 404s (older install) → poll /setup
 * instead; anything else keeps retrying until the timeout expires.
 */
async function probeHealth(urls, options = {}) {
  const list = Array.isArray(urls) ? urls : [urls];
  const { timeoutMs = DEFAULT_TIMEOUT_MS, now = Date.now } = options;
  const startedAt = now();
  const primary = await pollEndpoint(list[0], { ...options, deadline: startedAt + timeoutMs });
  if (primary.ok) return { ...primary, elapsedMs: now() - startedAt, endpoint: "healthz" };

  if (primary.missing && list.length > 1) {
    // Older install without /healthz — fall back to the legacy page.
    const fallback = await pollEndpoint(list[1], { ...options, deadline: startedAt + timeoutMs });
    if (fallback.ok) {
      return { ...fallback, elapsedMs: now() - startedAt, endpoint: "legacy", fellBackFrom404: true };
    }
    return {
      ...fallback,
      elapsedMs: now() - startedAt,
      healthzMissing: true,
      error: fallback.error || `HTTP ${fallback.status}`,
    };
  }

  return {
    ...primary,
    elapsedMs: now() - startedAt,
    error: primary.error || `HTTP ${primary.status}`,
  };
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
  const targets = resolveHealthTargets({
    dataDir: args["data-dir"],
    url: args.url,
    env: process.env,
  });
  process.stdout.write(`PrivGate health check → ${targets.join(" then ")}\n`);
  const result = await probeHealth(targets, {
    timeoutMs: Number(args["timeout-ms"]) || DEFAULT_TIMEOUT_MS,
    intervalMs: Number(args["interval-ms"]) || DEFAULT_INTERVAL_MS,
  });
  if (result.ok) {
    console.log(`healthy: HTTP ${result.status} in ${result.elapsedMs}ms (${result.endpoint} endpoint)`);
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
  healthUrls,
  parseEnvFile,
  pollEndpoint,
  probeHealth,
  resolveHealthTarget,
  resolveHealthTargets,
};

if (require.main === module) void fromCli().then((code) => process.exit(code));
