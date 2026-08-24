import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

type FakeConn = {
  destroyed: boolean;
  destroy(): void;
  once(event: string, handler: () => void): void;
};
type FakeServer = {
  listening: boolean;
  closed: boolean;
  close(onClosed?: () => void): void;
  on(event: string, handler: () => void): void;
};

const require_ = createRequire(import.meta.url);
const engine = require_(path.resolve(__dirname, "../../../packaging/graceful-shutdown.cjs")) as {
  DEFAULT_DRAIN_MS: number;
  createShutdownController: (deps: Record<string, unknown>) => {
    track: (server: FakeServer) => void;
    handleSignal: (name: string) => Promise<void>;
    isShuttingDown: () => boolean;
    pendingSockets: () => number;
  };
};

function makeServer(options: { hangsOnClose?: boolean } = {}): FakeServer {
  const closeHandlers: Array<() => void> = [];
  return {
    listening: true,
    closed: false,
    on: () => {},
    close(onClosed) {
      if (options.hangsOnClose) return; // simulates a stuck keep-alive socket
      this.closed = true;
      for (const handler of closeHandlers) handler();
      onClosed?.();
    },
  };
}

function fakeServerWithTracking() {
  const connHandlers: Array<(conn: FakeConn) => void> = [];
  const openConns = new Set<FakeConn>();
  let closeCb: (() => void) | undefined;
  const maybeClosed = () => {
    if (openConns.size === 0) {
      closeCb?.();
      closeCb = undefined;
    }
  };
  const server: FakeServer & { emitConnection(conn: FakeConn): void } = {
    listening: true,
    closed: false,
    on(event, handler) {
      if (event === "connection") connHandlers.push(handler);
    },
    close(onClosed) {
      this.closed = true;
      closeCb = () => onClosed?.();
      maybeClosed(); // nothing connected yet -> closes right away
    },
    emitConnection(conn) {
      openConns.add(conn);
      for (const handler of connHandlers) handler(conn);
    },
  };
  return server;
}

function makeConn(): FakeConn {
  const handlers = new Map<string, Array<() => void>>();
  return {
    destroyed: false,
    destroy() {
      this.destroyed = true;
      for (const handler of handlers.get("close") ?? []) handler();
    },
    once(event, handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
  };
}

describe("graceful shutdown engine (packaging/graceful-shutdown.cjs)", () => {
  it("stops accepting, runs hooks and exits cleanly", async () => {
    const exit = vi.fn();
    const hookOrder: string[] = [];
    const server = makeServer();
    const controller = engine.createShutdownController({
      servers: () => [server],
      hooks: async () => {
        hookOrder.push("hooks");
        expect(server.closed).toBe(true); // listener closed before app teardown
      },
      exit,
      drainMs: 50,
    });

    await controller.handleSignal("SIGTERM");

    expect(hookOrder).toEqual(["hooks"]);
    expect(controller.isShuttingDown()).toBe(true);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("waits for in-flight work inside the drain budget", async () => {
    const exit = vi.fn();
    let releaseClose: (() => void) | undefined;
    const server: FakeServer = {
      listening: true,
      closed: false,
      on: () => {},
      close(onClosed) {
        releaseClose = () => {
          this.closed = true;
          onClosed?.();
        };
      },
    };
    const controller = engine.createShutdownController({
      servers: () => [server],
      exit,
      drainMs: 500,
    });
    const signal = controller.handleSignal("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseClose?.();
    await signal;

    expect(exit).toHaveBeenCalledWith(0);
  });

  it("destroys stuck sockets at the drain deadline and still exits", async () => {
    const exit = vi.fn();
    const warn = vi.fn();
    const server = fakeServerWithTracking();
    const conn = makeConn();
    const controller = engine.createShutdownController({
      servers: () => [server],
      log: { warn, info: () => {} },
      exit,
      drainMs: 40,
    });
    controller.track(server);
    server.emitConnection(conn);

    const signal = controller.handleSignal("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(conn.destroyed).toBe(false); // still inside the drain window
    await signal;

    expect(conn.destroyed).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("destroyed 1 socket"));
    expect(exit).toHaveBeenCalledWith(0);
  }, 5000);

  it("forces an immediate non-zero exit when a second signal arrives", async () => {
    const exit = vi.fn();
    const warn = vi.fn();
    let releaseHooks: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (releaseHooks = resolve));
    const controller = engine.createShutdownController({
      servers: () => [],
      hooks: () => gate,
      log: { warn, info: () => {} },
      exit,
      drainMs: 1000,
    });

    const first = controller.handleSignal("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 10));
    await controller.handleSignal("SIGTERM");
    expect(exit).toHaveBeenCalledWith(1);

    releaseHooks?.();
    await first;
    expect(exit).toHaveBeenCalledTimes(1); // forced exit wins, clean path skipped
  });

  it("ignores signals after a forced exit was requested", async () => {
    const exit = vi.fn();
    const controller = engine.createShutdownController({
      servers: () => [],
      exit,
      drainMs: 10,
    });
    await controller.handleSignal("SIGINT");
    expect(exit).toHaveBeenCalledWith(0);
  });
});
