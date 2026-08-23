"use strict";

const http = require("node:http");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { displayHost, isLoopbackBind, parseListen } = require("./listen-config.cjs");

const root = path.join(__dirname, "..");
const cfg = parseListen(process.env);

process.env.HOSTNAME = cfg.bind;
process.env.PORT = String(cfg.webPort);

const nextBin = require.resolve("next/dist/bin/next", { paths: [root] });
const child = spawn(
  process.execPath,
  [nextBin, "dev", "--hostname", cfg.bind, "--port", String(cfg.webPort)],
  {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  },
);

function startAgentProxy() {
  const targetHost = isLoopbackBind(cfg.bind) || cfg.bind === "0.0.0.0" ? "127.0.0.1" : cfg.bind;
  const server = http.createServer((req, res) => {
    let pathname = "/";
    try {
      pathname = decodeURIComponent(String(req.url || "/").split("?")[0]);
    } catch {
      pathname = "/";
    }
    if (!pathname.startsWith("/api/agent")) {
      res.statusCode = 404;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "this port accepts agent traffic only" }));
      return;
    }
    const proxy = http.request(
      {
        hostname: targetHost,
        port: cfg.webPort,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (up) => {
        res.writeHead(up.statusCode || 502, up.headers);
        up.pipe(res);
      },
    );
    proxy.on("error", () => {
      if (!res.headersSent) {
        res.statusCode = 502;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: "console not reachable" }));
      }
    });
    req.pipe(proxy);
  });
  server.on("error", (err) => {
    console.error(`PrivGate agent port ${cfg.agentPort} failed:`, err.message);
  });
  server.listen(cfg.agentPort, cfg.bind, () => {
    console.log(`PrivGate agents   http://${displayHost(cfg.bind)}:${cfg.agentPort}/api/agent/ (dev proxy)`);
  });
  server.on("upgrade", (req, socket, head) => {
    let pathname = "/";
    try {
      pathname = decodeURIComponent(String(req.url || "/").split("?")[0]);
    } catch {
      pathname = "/";
    }
    if (!pathname.startsWith("/api/agent")) {
      socket.destroy();
      return;
    }
    const headers = { ...req.headers, host: `${targetHost}:${cfg.webPort}` };
    const proxy = http.request({
      hostname: targetHost,
      port: cfg.webPort,
      path: req.url,
      method: req.method,
      headers,
    });
    proxy.on("upgrade", (upRes, upSocket, upHead) => {
      const lines = [`HTTP/1.1 ${upRes.statusCode} Switching Protocols`];
      for (const [key, value] of Object.entries(upRes.headers)) {
        if (value === undefined) continue;
        lines.push(`${key}: ${Array.isArray(value) ? value.join(", ") : value}`);
      }
      socket.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (upHead && upHead.length) upSocket.write(upHead);
      if (head && head.length) socket.write(head);
      upSocket.pipe(socket);
      socket.pipe(upSocket);
    });
    proxy.on("error", () => socket.destroy());
    proxy.end();
  });
}

if (cfg.splitPorts) startAgentProxy();
else console.log("PrivGate agents share the console port");

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
