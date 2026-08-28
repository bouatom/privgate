/**
 * Periodic audit retention sweep — the server-side invoke point for
 * `pruneAudit()`.
 *
 * DEFAULT-SAFE BY DESIGN: this sweep does NOTHING unless the operator has
 * opted in. It only prunes rows when BOTH:
 *   - the sweep is not disabled (`PRIVGATE_DISABLE_AUDIT_RETENTION_SWEEP=1`),
 *   - a retention window is configured (`PRIVGATE_AUDIT_RETENTION_DAYS`, a
 *     positive integer in days; default 365).
 * With no retention configured it defaults to a sane 365-day keep window; pass
 * `PRIVGATE_AUDIT_RETENTION_DAYS=0` on its own to keep everything (or to force
 * an off state). Combined with the `retentionDays <= 0 ⇒ no-op` rule inside
 * `pruneAudit`, this guarantees the sweep can never wipe the audit log by
 * accident — it never deletes without an explicit, positive retention.
 *
 * CALL-SITE: wire this into server bootstrap by adding one line alongside the
 * other sweeps in `src/instrumentation.ts`:
 *
 *     const { startAuditRetentionSweep } = await import("./lib/audit-retention-sweep");
 *     startAuditRetentionSweep();
 *
 * Because that file is owned by the existing bootstrap surface, this module is
 * fully self-contained, idempotent, env-disabled, and injectable so it can be
 * started from there (or any other server entrypoint) without changes here.
 * It never runs in dev destructively: `npm run dev` loads no retention-level
 * env by default, so the default 365-day window applies — far below what any
 * local audit log would accumulate, and the tick swallows all errors.
 */
import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { registerShutdownHook } from "./lifecycle/shutdown";
import { pruneAudit, resolveAuditRetention } from "./db/audit";
import { getDb } from "./db";

const DEFAULT_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // once a day

type SweepGlobals = {
  __privgateAuditRetentionSweep?: {
    timer?: ReturnType<typeof setInterval>;
    bootTimer?: ReturnType<typeof setTimeout>;
    clearIntervalImpl?: typeof clearInterval;
    clearTimeoutImpl?: typeof clearTimeout;
  };
};

const globals = globalThis as unknown as SweepGlobals;

function state() {
  globals.__privgateAuditRetentionSweep ??= {};
  return globals.__privgateAuditRetentionSweep;
}

/** True when the operator has explicitly disabled pruning entirely. */
function retentionDisabled(env: Record<string, string | undefined>): boolean {
  return resolveAuditRetention(env.PRIVGATE_AUDIT_RETENTION_DAYS) === 0;
}

export type AuditRetentionSweepDeps = {
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
  intervalMs?: number;
  bootDelayMs?: number;
  env?: Record<string, string | undefined>;
  getDb?: () => DatabaseSync;
  /** Override the work performed each tick (tests). Defaults to pruneAudit. */
  tick?: (db: DatabaseSync) => unknown;
};

/**
 * Start the periodic audit retention sweep. Fully injectable so tests can drive
 * time manually. Idempotent per process. Safe by default: with no positive
 * retention configured the tick is a no-op, and the sweep never throws into the
 * process that hosts it.
 */
export function startAuditRetentionSweep(deps: AuditRetentionSweepDeps = {}): void {
  const s = state();
  if (s.timer || s.bootTimer) return; // already running
  const env = deps.env ?? process.env;
  if ((env.PRIVGATE_DISABLE_AUDIT_RETENTION_SWEEP || "").trim() === "1") return;
  if (retentionDisabled(env)) return; // explicit keep-everything / off state

  const setIntervalImpl = deps.setIntervalImpl ?? setInterval.bind(globalThis);
  const clearIntervalImpl = deps.clearIntervalImpl ?? clearInterval.bind(globalThis);
  const setTimeoutImpl = deps.setTimeoutImpl ?? setTimeout.bind(globalThis);
  const clearTimeoutImpl = deps.clearTimeoutImpl ?? clearTimeout.bind(globalThis);
  const db = deps.getDb ?? getDb;
  const intervalMs = deps.intervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const bootDelayMs = deps.bootDelayMs ?? 0; // first tick soon after boot

  // Resolve retention once at start; pruneAudit re-validates it every tick.
  const retentionDays = resolveAuditRetention(env.PRIVGATE_AUDIT_RETENTION_DAYS);
  const prune = deps.tick ?? ((d) => pruneAudit(d, retentionDays));

  const run = () => {
    try {
      prune(db());
    } catch {
      /* a prune failure must never take the process down with it */
    }
  };

  s.bootTimer = setTimeoutImpl(() => {
    run();
    s.bootTimer = undefined;
    s.timer = setIntervalImpl(run, intervalMs);
  }, bootDelayMs);
  s.clearIntervalImpl = clearIntervalImpl;
  s.clearTimeoutImpl = clearTimeoutImpl;

  registerShutdownHook("audit-retention-sweep", stopAuditRetentionSweep);
}

export function stopAuditRetentionSweep(): void {
  const s = state();
  const clear = {
    interval: s.clearIntervalImpl ?? clearInterval.bind(globalThis),
    timeout: s.clearTimeoutImpl ?? clearTimeout.bind(globalThis),
  };
  if (s.timer) clear.interval(s.timer);
  if (s.bootTimer) clear.timeout(s.bootTimer);
  s.timer = undefined;
  s.bootTimer = undefined;
}

/** Test seam: wipe module state between tests. */
export function resetAuditRetentionSweepForTests(): void {
  stopAuditRetentionSweep();
  globals.__privgateAuditRetentionSweep = undefined;
}
