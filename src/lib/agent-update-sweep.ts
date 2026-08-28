import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { requestAgentUpdate } from "./agent-update";
import { currentClientVersion, updateAvailable } from "./client-version";
import { getDb, listDeviceSummaries } from "./db";
import { effectiveUpdatePolicy, scheduledWindowDue, type PolicyDevice } from "./update-policy";
import { registerShutdownHook } from "./lifecycle/shutdown";

/**
 * Agent update sweep: auto-push the served agent build to devices whose
 * effective update policy says they should get it now.
 *
 * Resolution per device:
 *   1. skip manual
 *   2. skip devices already on (or beyond) the served build
 *   3. auto  → push/queue immediately
 *   4. scheduled → push/queue only while inside the maintenance window
 *
 * This is a best-effort background job: it never throws into request paths —
 * every iteration is wrapped so one bad row cannot stop the loop.
 */

const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

export type AgentUpdateSweepResult = {
  scanned: number;
  pushed: number;
  queued: number;
  toUpdate: number;
};

/**
 * Iterate all devices and push an update to each one that is due under its
 * effective policy. Returns coarse counters so tests and dashboards can assert
 * behavior without caring which specific device was touched.
 */
export function sweepDueDevices(db: DatabaseSync): AgentUpdateSweepResult {
  const target = currentClientVersion();
  const result: AgentUpdateSweepResult = { scanned: 0, pushed: 0, queued: 0, toUpdate: 0 };

  for (const device of listDeviceSummaries(db)) {
    result.scanned += 1;

    const deviceView: PolicyDevice = {
      id: device.id,
      updateMode: device.updateMode,
      updateSchedule: device.updateSchedule,
    };
    const policy = effectiveUpdatePolicy(db, deviceView);
    if (policy.mode === "manual") continue;
    if (!updateAvailable(device.agentVersion, target)) continue;

    if (policy.mode === "scheduled" && !scheduledWindowDue(policy.schedule, new Date())) continue;

    const outcome = requestAgentUpdate(db, device.id, "system");
    if (!outcome.ok) continue;
    result.toUpdate += 1;
    if (outcome.queued) result.queued += 1;
    else result.pushed += 1;
  }
  return result;
}

export type AgentUpdateSweepDeps = {
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
  intervalMs?: number;
  env?: Record<string, string | undefined>;
  getDb?: () => DatabaseSync;
  /** Override the work performed each tick (tests). Defaults to sweepDueDevices. */
  tick?: (db: DatabaseSync) => unknown;
};

type SweepGlobals = {
  __privgateAgentUpdateSweep?: {
    timer?: ReturnType<typeof setInterval>;
    bootTimer?: ReturnType<typeof setTimeout>;
    clearIntervalImpl?: typeof clearInterval;
    clearTimeoutImpl?: typeof clearTimeout;
  };
};

const globals = globalThis as unknown as SweepGlobals;

function state() {
  globals.__privgateAgentUpdateSweep ??= {};
  return globals.__privgateAgentUpdateSweep;
}

/**
 * Start the periodic agent update sweep. First tick fires immediately (no long
 * boot delay — the sweep is cheap and read-mostly), then every interval.
 * Env-disabled with PRIVGATE_DISABLE_AGENT_UPDATE_SWEEP=1; fully injectable so
 * tests can drive time manually. Idempotent per process.
 */
export function startAgentUpdateSweep(deps: AgentUpdateSweepDeps = {}): void {
  const s = state();
  if (s.timer || s.bootTimer) return; // already running
  const env = deps.env ?? process.env;
  if ((env.PRIVGATE_DISABLE_AGENT_UPDATE_SWEEP || "").trim() === "1") return;

  const setIntervalImpl = deps.setIntervalImpl ?? setInterval.bind(globalThis);
  const clearIntervalImpl = deps.clearIntervalImpl ?? clearInterval.bind(globalThis);
  const setTimeoutImpl = deps.setTimeoutImpl ?? setTimeout.bind(globalThis);
  const clearTimeoutImpl = deps.clearTimeoutImpl ?? clearTimeout.bind(globalThis);
  const db = deps.getDb ?? getDb;
  const envInterval = Number.parseInt(
    env.PRIVGATE_AGENT_UPDATE_SWEEP_INTERVAL_MS || env.AGENT_UPDATE_SWEEP_INTERVAL_MS || "",
    10,
  );
  const intervalMs = (deps.intervalMs ?? envInterval) || DEFAULT_SWEEP_INTERVAL_MS;
  const tick = deps.tick ?? sweepDueDevices;

  const run = () => {
    try {
      tick(db());
    } catch {
      /* the sweep must never take the process down with it */
    }
  };

  // First sweep immediately on boot so a freshly-started control plane catches
  // up without waiting a full interval.
  s.bootTimer = setTimeoutImpl(() => {
    run();
    s.bootTimer = undefined;
    s.timer = setIntervalImpl(run, intervalMs);
  }, 0);
  s.clearIntervalImpl = clearIntervalImpl;
  s.clearTimeoutImpl = clearTimeoutImpl;

  registerShutdownHook("agent-update-sweep", stopAgentUpdateSweep);
}

export function stopAgentUpdateSweep(): void {
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
export function resetAgentUpdateSweepForTests(): void {
  stopAgentUpdateSweep();
  globals.__privgateAgentUpdateSweep = undefined;
}
