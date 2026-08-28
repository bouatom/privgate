import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { listAudit, resetDbForTests } from "./db";
import {
  resetAuditRetentionSweepForTests,
  startAuditRetentionSweep,
  stopAuditRetentionSweep,
} from "./audit-retention-sweep";

function insertEvent(db: ReturnType<typeof resetDbForTests>, at: string, action: string): void {
  db.prepare(
    `INSERT INTO audit_events (id, at, actor, action, target, details) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), at, "actor", action, "req-1", "{}");
}

function dayAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Fake timer plumbing so tests drive the sweep manually instead of real
 * `setTimeout`/`setInterval`. Captures the fired functions and exposes fire()
 * to run them on demand. The implementations are cast to the real timer types
 * so they satisfy `AuditRetentionSweepDeps`.
 */
function manualTimers() {
  let bootFn: (() => void) | null = null;
  let intervalFn: (() => void) | null = null;
  let scheduledBoot = false;
  let id = 0;
  const setTimeoutImpl = ((fn: () => void) => {
    bootFn = fn;
    scheduledBoot = true;
    return ++id;
  }) as unknown as typeof setTimeout;
  const setIntervalImpl = ((fn: () => void) => {
    intervalFn = fn;
    return ++id;
  }) as unknown as typeof setInterval;
  const clearTimeoutImpl = ((): void => undefined) as unknown as typeof clearTimeout;
  const clearIntervalImpl = ((): void => undefined) as unknown as typeof clearInterval;
  return {
    setTimeoutImpl,
    setIntervalImpl,
    clearTimeoutImpl,
    clearIntervalImpl,
    get scheduledBoot() {
      return scheduledBoot;
    },
    fireBoot: () => {
      const fn = bootFn;
      bootFn = null;
      fn?.();
    },
    fireInterval: () => intervalFn?.(),
  };
}

afterEach(() => {
  stopAuditRetentionSweep();
  resetAuditRetentionSweepForTests();
  resetDbForTests(":memory:");
});

describe("startAuditRetentionSweep", () => {
  it("prunes rows older than a configured retention on the boot tick", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    insertEvent(db, dayAgo(100), "old.a");
    insertEvent(db, dayAgo(1), "new.b");

    const t = manualTimers();
    startAuditRetentionSweep({ ...t, env: { PRIVGATE_AUDIT_RETENTION_DAYS: "30" }, getDb: () => db });
    expect(t.scheduledBoot).toBe(true);
    t.fireBoot();

    expect(listAudit(db).map((e) => e.action)).toEqual(["new.b"]);

    t.fireInterval(); // interval keeps pruning without throwing
    expect(listAudit(db).map((e) => e.action)).toEqual(["new.b"]);
  });

  it("defaults to the 365-day retention when none is configured", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    insertEvent(db, dayAgo(500), "old.a");

    const t = manualTimers();
    startAuditRetentionSweep({ ...t, env: {}, getDb: () => db });
    expect(t.scheduledBoot).toBe(true);
    t.fireBoot();

    expect(listAudit(db)).toEqual([]); // 500d old is beyond the 365d default
  });

  it("does not schedule (and deletes nothing) when retention is explicitly disabled", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    insertEvent(db, dayAgo(1000), "keeper");

    const t = manualTimers();
    startAuditRetentionSweep({ ...t, env: { PRIVGATE_AUDIT_RETENTION_DAYS: "-1" }, getDb: () => db });

    expect(t.scheduledBoot).toBe(false); // boot tick never wired
    expect(listAudit(db).length).toBe(1); // nothing deleted
  });

  it("does not schedule when globally disabled by env", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    const t = manualTimers();
    startAuditRetentionSweep({
      ...t,
      env: { PRIVGATE_DISABLE_AUDIT_RETENTION_SWEEP: "1" },
      getDb: () => db,
    });
    expect(t.scheduledBoot).toBe(false);
  });

  it("is idempotent — a second start does not double-schedule", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    const t = manualTimers();
    startAuditRetentionSweep({ ...t, env: { PRIVGATE_AUDIT_RETENTION_DAYS: "30" }, getDb: () => db });
    // Second start with a fresh timer set must NOT create a second boot tick.
    const t2 = manualTimers();
    startAuditRetentionSweep({ ...t2, env: { PRIVGATE_AUDIT_RETENTION_DAYS: "30" }, getDb: () => db });
    expect(t2.scheduledBoot).toBe(false); // already running → no new schedule
    expect(t.scheduledBoot).toBe(true); // original still armed
  });
});
