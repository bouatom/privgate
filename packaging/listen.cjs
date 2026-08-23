"use strict";

const http = require("node:http");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { displayHost, isLoopbackBind, parseListen } = require("./listen-config.cjs");

function appDir() {
  if (process.env.PRIVGATE_APP_DIR) return process.env.PRIVGATE_APP_DIR;
  if (fs.existsSync(path.join(__dirname, ".next"))) return __dirname;
  return path.join(__dirname, "..");
}

function loadStandaloneConfig(dir) {
  const file = path.join(dir, ".next", "required-server-files.json");
  if (!fs.existsSync(file)) {
    throw new Error(`PrivGate cannot start: missing ${file}. Rebuild the console installer.`);
  }
  const required = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!required || typeof required.config !== "object" || required.config == null) {
    throw new Error("PrivGate cannot start: required-server-files.json has no config");
  }
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(required.config);
}

function listen(server, port, bind) {
  return new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    server.once("error", onError);
    server.listen(port, bind, () => {
      server.removeListener("error", onError);
      resolve();
    });
  });
}

function ensureWindowsFirewall(ports) {
  if (process.platform !== "win32") return;
  const unique = [...new Map(ports.map((row) => [row.port, row])).values()];
  for (const { name, port } of unique) {
    execFile("netsh", ["advfirewall", "firewall", "delete", "rule", `name=${name}`], () => {
      execFile(
        "netsh",
        [
          "advfirewall",
          "firewall",
          "add",
          "rule",
          `name=${name}`,
          "dir=in",
          "action=allow",
          "protocol=TCP",
          "profile=any",
          `localport=${String(port)}`,
        ],
        (err) => {
          if (err) console.warn(`Windows Firewall: could not add ${name} (TCP ${port}): ${err.message}`);
        },
      );
    });
  }
}

function agentOnly(req) {
  try {
    const pathname = decodeURIComponent(String(req.url || "/").split("?")[0]);
    return pathname.startsWith("/api/agent");
  } catch {
    return false;
  }
}

process.env.NODE_ENV = process.env.NODE_ENV || "production";

async function main() {
  const dir = appDir();
  process.env.PRIVGATE_APP_DIR = dir;
  const cfg = parseListen(process.env);
  process.env.HOSTNAME = cfg.bind;
  process.env.PORT = String(cfg.webPort);
  process.chdir(dir);
  loadStandaloneConfig(dir);

  // Standalone traces omit webpack. `require("next")` loads it and crashes the
  // Windows service with exit 1. Use the same handler path as Next's server.js.
  const { getRequestHandlers } = require("next/dist/server/lib/start-server");

  let requestHandler = async (_req, res) => {
    res.statusCode = 503;
    res.end("PrivGate is starting");
  };

  function attach(kind) {
    return (req, res) => {
      if (kind === "agent" && !agentOnly(req)) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: "this port accepts agent traffic only" }));
        return;
      }
      void requestHandler(req, res);
    };
  }

  const web = http.createServer(attach("web"));
  await listen(web, cfg.webPort, cfg.bind);

  const handlers = await getRequestHandlers({
    dir,
    port: cfg.webPort,
    isDev: false,
    server: web,
    hostname: cfg.bind,
  });
  requestHandler = handlers.requestHandler;
  if (typeof handlers.upgradeHandler === "function") {
    web.on("upgrade", (req, socket, head) => {
      void handlers.upgradeHandler(req, socket, head);
    });
  }

  console.log(`PrivGate console  http://${displayHost(cfg.bind)}:${cfg.webPort}/`);

  if (cfg.splitPorts) {
    const agent = http.createServer(attach("agent"));
    await listen(agent, cfg.agentPort, cfg.bind);
    if (typeof handlers.upgradeHandler === "function") {
      agent.on("upgrade", (req, socket, head) => {
        if (!agentOnly(req)) {
          socket.destroy();
          return;
        }
        void handlers.upgradeHandler(req, socket, head);
      });
    }
    console.log(`PrivGate agents   http://${displayHost(cfg.bind)}:${cfg.agentPort}/api/agent/`);
  } else {
    console.log("PrivGate agents share the console port");
  }

  if (!isLoopbackBind(cfg.bind)) {
    const rules = [{ name: "PrivGate Console", port: cfg.webPort }];
    if (cfg.splitPorts) rules.push({ name: "PrivGate Agents", port: cfg.agentPort });
    ensureWindowsFirewall(rules);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
