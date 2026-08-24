/**
 * Process shutdown hooks for the control plane.
 *
 * The packaged entrypoint (packaging/listen.cjs) stops accepting connections
 * on SIGTERM/SIGINT and then calls `globalThis.__privgateRunShutdownHooks`.
 * Server-side modules register teardown work here — today: closing agent
 * WebSockets with a proper close frame and closing the SQLite handle so the
 * WAL is checkpointed before package managers swap files.
 *
 * Keep this module free of heavy imports; it is loaded by the realtime hub
 * and by the DB connection at boot.
 */

export type ShutdownLog = {
  warn?: (...args: unknown[]) => void;
};

export type ShutdownHook = () => void | Promise<void>;

type HookGlobals = {
  __privgateShutdownHooks?: Map<string, ShutdownHook>;
  __privgateRunShutdownHooks?: (log?: ShutdownLog) => Promise<string[]>;
  __privgateShutdownRunnerInstalled?: boolean;
};

const globals = globalThis as unknown as HookGlobals;

function registry(): Map<string, ShutdownHook> {
  if (!globals.__privgateShutdownHooks) {
    globals.__privgateShutdownHooks = new Map();
  }
  return globals.__privgateShutdownHooks;
}

/**
 * Registers (or replaces) a named teardown hook. Hooks run in registration
 * order when the process is asked to stop.
 */
export function registerShutdownHook(name: string, hook: ShutdownHook): void {
  registry().set(name, hook);
}

/** Current hook names in execution order — exposed for tests and logging. */
export function shutdownHookNames(): string[] {
  return [...registry().keys()];
}

/**
 * Runs every hook in order, isolating failures so one broken teardown cannot
 * block the rest. Returns the names that were attempted.
 */
export async function runShutdownHooks(log?: ShutdownLog): Promise<string[]> {
  const attempted: string[] = [];
  for (const [name, hook] of registry()) {
    attempted.push(name);
    try {
      await hook();
    } catch (err) {
      log?.warn?.(`PrivGate shutdown hook '${name}' failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return attempted;
}

// Expose the runner on globalThis so the plain-CJS packaged entrypoint can
// trigger it without importing compiled server chunks.
if (!globals.__privgateShutdownRunnerInstalled) {
  globals.__privgateRunShutdownHooks = async (log?: ShutdownLog) => runShutdownHooks(log);
  globals.__privgateShutdownRunnerInstalled = true;
}
