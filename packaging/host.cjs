"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { applyInstallerConfig, loadEnvIntoProcess } = require("./write-env.cjs");
const { isLoopbackBind, isWildcardBind, parseListen } = require("./listen-config.cjs");

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

const dataDir = defaultDataDir();
applyInstallerConfig(dataDir, {});
loadEnvIntoProcess(dataDir);

// Must stay CommonJS next to this file — the installer does not ship src/*.ts.
const { validateStartupSecretsOrExit } = require("./startup-validation.cjs");
validateStartupSecretsOrExit(process.env, console);

const cfg = parseListen(process.env);
if (!process.env.PRIVGATE_PUBLIC_ORIGIN && !isWildcardBind(cfg.bind) && !isLoopbackBind(cfg.bind)) {
  process.env.PRIVGATE_PUBLIC_ORIGIN = `http://${cfg.bind}:${cfg.webPort}`;
}
fs.mkdirSync(dataDir, { recursive: true });
process.env.PRIVGATE_APP_DIR = process.env.PRIVGATE_APP_DIR || __dirname;
process.chdir(__dirname);
require("./listen.cjs");
