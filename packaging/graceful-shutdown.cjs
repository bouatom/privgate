"use strict";

/**
 * Graceful shutdown for the packaged PrivGate console.
 *
 * Package managers stop the service with SIGTERM (launchd, systemd) or a
 * process kill (WinSW) before swapping files. Without a handler Node dies
 * mid-request: agent WebSockets drop without a close frame, in-flight HTTP
 * responses are cut off, and the SQLite WAL is left dirty. This module owns
 * the stop sequence so `systemctl stop privgate`, `launchctl bootout …` and
 * the updater scripts get a clean exit instead of a kill.
 *
 * Plain CommonJS on purpose: the installed console runs `node host.cjs` and
 * does not ship `src/`. Pure logic lives in createShutdownController so the
 * vitest suite can exercise it without signals or real servers.
 */

const DEFAULT_DRAIN_MS = 8000;

/** Resolves with true when work finishes inside budget, false on timeout. */
async function withinBudget(work, budgetMs) {
  let timer;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), budgetMs);
  });
  try {
    return await Promise.race([
      work.then(
        () => true,
        () => true,
      ),
      timedOut,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Builds the shutdown sequence from injected parts:
 *  - servers(): [{ close(onClosed) }] — listeners to stop accepting on.
 *  - hooks(): app-level teardown promise (WS close frames, SQLite close).
 *  - log / exit / drainMs — seams for tests.
 */
function createShutdownController(deps = {}) {
  const {
    servers = () => [],
    hooks = async () => {},
    log = console,
    exit = (code) => process.exit(code),
    drainMs = DEFAULT_DRAIN_MS,
  } = deps;

  const sockets = new Set();
  let shuttingDown = false;
  let forced = false;

  function track(server) {
    if (!server || typeof server.on !== "function") return;
    server.on("connection", (conn) => {
      sockets.add(conn);
      conn.once("close", () => sockets.delete(conn));
      conn.once("error", () => sockets.delete(conn));
    });
  }

  function closeServer(server) {
    return new Promise((resolve) => {
      if (!server || typeof server.close !== "function") return resolve();
      try {
        // Node >= 19 ends idle keep-alive sockets itself; active ones get
        // the rest of the drain window before we destroy them.
        server.close(() => resolve());
      } catch (err) {
        log.warn?.(`PrivGate shutdown: listener close failed (${err && err.message})`);
        resolve();
      }
    });
  }

  function destroyLeftovers() {
    let destroyed = 0;
    for (const conn of sockets) {
      try {
        conn.destroy();
        destroyed += 1;
      } catch {
        // already gone
      }
    }
    return destroyed;
  }

  async function runSequence(signalName) {
    const startedAt = Date.now();
    log.info?.(`PrivGate shutting down (${signalName}), draining up to ${drainMs}ms`);

    // 1. Stop accepting new work; existing sockets may finish in-flight.
    const list = servers() || [];
    for (const server of list) track(server);
    const allClosed = Promise.all(list.map(closeServer));
    const finishedInBudget = await withinBudget(allClosed, drainMs);

    // 2. App-level hooks: WebSocket close frames (1001), SQLite close, …
    try {
      await withinBudget(Promise.resolve(hooks()), Math.max(250, drainMs / 2));
    } catch (err) {
      log.warn?.(`PrivGate shutdown: hook failure ignored (${err && err.message})`);
    }

    // 3. When every listener reported closed, its sockets drained on their
    // own. Only cut stragglers that outlived their budget.
    if (!finishedInBudget) {
      const destroyed = destroyLeftovers();
      if (destroyed > 0) {
        log.warn?.(`PrivGate shutdown: destroyed ${destroyed} socket(s) at drain deadline`);
      }
    }

    // A repeat signal already requested a forced exit; do not override it.
    if (!forced) {
      log.info?.(`PrivGate stopped cleanly in ${Date.now() - startedAt}ms`);
      exit(0);
    }
  }

  return {
    /** Call once per server at boot so pre-signal connections are tracked. */
    track,
    /** Signal entry point. First call drains; a repeat forces the exit. */
    async handleSignal(signalName) {
      if (forced) return;
      if (shuttingDown) {
        forced = true;
        log.warn?.(`PrivGate shutdown: ${signalName} again — exiting immediately`);
        exit(1);
        return;
      }
      shuttingDown = true;
      await runSequence(signalName);
    },
    isShuttingDown() {
      return shuttingDown;
    },
    pendingSockets() {
      return sockets.size;
    },
  };
}

/**
 * Registers signal handlers on the live process. App-level teardown hooks
 * come from src/lib/lifecycle/shutdown.ts via globalThis when Next is up.
 */
function installGracefulShutdown(options = {}) {
  const { signals = ["SIGTERM", "SIGINT"], serverList = [], hooks, ...rest } = options;
  const controller = createShutdownController({
    ...rest,
    servers: () => serverList,
    hooks:
      hooks ||
      (async () => {
        const run = globalThis.__privgateRunShutdownHooks;
        if (typeof run === "function") await run(rest.log || console);
      }),
  });

  for (const server of serverList) controller.track(server);
  for (const name of signals) {
    process.on(name, () => {
      void controller.handleSignal(name);
    });
  }
  return controller;
}

module.exports = {
  DEFAULT_DRAIN_MS,
  createShutdownController,
  installGracefulShutdown,
};
