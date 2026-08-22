"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function defaultDataDir() {
  if (process.env.PRIVGATE_DATA_DIR) return process.env.PRIVGATE_DATA_DIR;
  if (process.platform === "win32") {
    return path.join(process.env.ProgramData || "C:\\ProgramData", "PrivGate");
  }
  if (process.platform === "darwin") {
    return "/Library/Application Support/PrivGate";
  }
  return "/var/lib/privgate";
}

function parseEnvFile(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function secret() {
  return crypto.randomBytes(32).toString("base64url");
}

function ensureEnv(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const envPath = path.join(dir, "console.env");
  if (!fs.existsSync(envPath)) {
    const body = [
      "# Generated on first start. Do not commit this file.",
      `SESSION_SECRET=${secret()}`,
      `TICKET_SIGNING_KEY=${secret()}`,
      `DEVICE_SECRET_KEY=${secret()}`,
      "AUTH_MODE=development",
      "PORT=3000",
      "HOSTNAME=127.0.0.1",
      "",
    ].join(os.EOL);
    fs.writeFileSync(envPath, body, { mode: 0o600 });
  }
  const parsed = parseEnvFile(fs.readFileSync(envPath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] == null || process.env[key] === "") process.env[key] = value;
  }
  process.env.NODE_ENV = process.env.NODE_ENV || "production";
  process.env.PRIVGATE_DB = process.env.PRIVGATE_DB || path.join(dir, "privgate.db");
  process.env.PORT = process.env.PORT || "3000";
  process.env.HOSTNAME = process.env.HOSTNAME || "127.0.0.1";
  if (!process.env.PRIVGATE_PUBLIC_ORIGIN) {
    process.env.PRIVGATE_PUBLIC_ORIGIN = `http://${process.env.HOSTNAME}:${process.env.PORT}`;
  }
  return envPath;
}

const dataDir = defaultDataDir();
ensureEnv(dataDir);
process.chdir(__dirname);
require("./server.js");
