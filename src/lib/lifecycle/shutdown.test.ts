import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerShutdownHook,
  runShutdownHooks,
  shutdownHookNames,
} from "./shutdown";

const globalHooks = globalThis as unknown as { __privgateShutdownHooks?: Map<string, () => void> };

afterEach(() => {
  globalHooks.__privgateShutdownHooks?.clear();
});

describe("shutdown hook registry", () => {
  it("runs hooks in registration order and reports the attempted names", async () => {
    const ran: string[] = [];
    registerShutdownHook("agent-websockets", () => void ran.push("ws"));
    registerShutdownHook("database", () => void ran.push("db"));

    const attempted = await runShutdownHooks();

    expect(attempted).toEqual(["agent-websockets", "database"]);
    expect(ran).toEqual(["ws", "db"]);
  });

  it("replaces a hook when the same name registers again (db re-open)", async () => {
    const ran: string[] = [];
    registerShutdownHook("database", () => void ran.push("first"));
    registerShutdownHook("database", () => void ran.push("second"));

    expect(shutdownHookNames()).toEqual(["database"]);
    await runShutdownHooks();
    expect(ran).toEqual(["second"]);
  });

  it("isolates failures so one broken hook cannot block teardown", async () => {
    const warn = vi.fn();
    const ran: string[] = [];
    registerShutdownHook("agent-websockets", () => {
      throw new Error("socket already destroyed");
    });
    registerShutdownHook("database", () => void ran.push("db"));

    const attempted = await runShutdownHooks({ warn });

    expect(attempted).toEqual(["agent-websockets", "database"]);
    expect(ran).toEqual(["db"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("agent-websockets"));
  });

  it("supports async hooks and awaits completion before returning", async () => {
    let closed = false;
    registerShutdownHook("slow-teardown", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      closed = true;
    });

    await runShutdownHooks();
    expect(closed).toBe(true);
  });

  it("exposes the runner on globalThis for the plain-CJS packaged entrypoint", async () => {
    const globals = globalThis as unknown as {
      __privgateRunShutdownHooks?: (log?: unknown) => Promise<string[]>;
      __privgateShutdownRunnerInstalled?: boolean;
    };
    expect(globals.__privgateShutdownRunnerInstalled).toBe(true);
    expect(typeof globals.__privgateRunShutdownHooks).toBe("function");
    const names = await globals.__privgateRunShutdownHooks?.();
    expect(names).toEqual(shutdownHookNames());
  });
});
