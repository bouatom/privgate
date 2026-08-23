"use strict";

const DEFAULT_WEB_PORT = 3000;
const DEFAULT_AGENT_PORT = 3001;
const DEFAULT_BIND = "0.0.0.0";
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const WILDCARD = new Set(["0.0.0.0", "::", "[::]"]);

function parseListenPort(raw, fallback) {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return fallback;
  return n;
}

function isLoopbackBind(bind) {
  return LOOPBACK.has(String(bind || "").trim().toLowerCase());
}

function isWildcardBind(bind) {
  return WILDCARD.has(String(bind || "").trim());
}

function parseListen(env = process.env) {
  const bind = String(env.PRIVGATE_BIND || env.HOSTNAME || DEFAULT_BIND).trim() || DEFAULT_BIND;
  const webPort = parseListenPort(env.PRIVGATE_WEB_PORT || env.PORT, DEFAULT_WEB_PORT);
  const agentPort = parseListenPort(env.PRIVGATE_AGENT_PORT, DEFAULT_AGENT_PORT);
  return { bind, webPort, agentPort, splitPorts: agentPort !== webPort };
}

function displayHost(bind) {
  if (isWildcardBind(bind)) return "<all-interfaces>";
  return bind;
}

module.exports = {
  DEFAULT_AGENT_PORT,
  DEFAULT_BIND,
  DEFAULT_WEB_PORT,
  displayHost,
  isLoopbackBind,
  isWildcardBind,
  parseListen,
  parseListenPort,
};
