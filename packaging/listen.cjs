"use strict";

const http = require("node:http");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("node:url");
const { displayHost, isLoopbackBind, parseListen } = require("./listen-config.cjs");

function appDir() {
  if (process.env.PRIVGATE_APP_DIR) return process.env.PRIVGATE_APP_DIR;
  if (fs.existsSync(path.join(__dirname, ".next"))) return __dirname;
  return path.join(__dirname, "..");
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
  const cfg = parseListen(process.env);
  process.env.HOSTNAME = cfg.bind;
  process.env.PORT = String(cfg.webPort);
  process.chdir(dir);

  const next = require(require.resolve("next", { paths: [dir] }));
  const app = next({
    dev: false,
    dir,
    hostname: cfg.bind,
    port: cfg.webPort,
  });
  await app.prepare();
  const handle = app.getRequestHandler();

  function attach(kind) {
    return (req, res) => {
      if (kind === "agent" && !agentOnly(req)) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: "this port accepts agent traffic only" }));
        return;
      }
      const parsedUrl = parse(req.url || "/", true);
      void handle(req, res, parsedUrl);
    };
  }

  const web = http.createServer(attach("web"));
  await listen(web, cfg.webPort, cfg.bind);
  console.log(`PrivGate console  http://${displayHost(cfg.bind)}:${cfg.webPort}/`);

  if (cfg.splitPorts) {
    const agent = http.createServer(attach("agent"));
    await listen(agent, cfg.agentPort, cfg.bind);
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
