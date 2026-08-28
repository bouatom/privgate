import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listAudit, resetDbForTests } from "./db";
import { setDeviceAgentVersion, setDeviceUpdateRequestedAt } from "./db";
import { registerDeviceSocket, resetRealtimeForTests } from "./realtime/bus";
import { registerTrackedDeviceSocket } from "./realtime/agent-hub";
import { handleAgentRpc } from "./realtime/rpc";
import {
  drainQueuedUpdateOnReconnect,
  parsePendingMarker,
  pendingMarker,
  requestAgentUpdate,
  reconcileReportedVersion,
} from "./agent-update";
import { sanitizeClientVersion } from "./client-version";
import { disableRepoVersionManifest, resetVersionEnv } from "@/test/version-manifest";

const device = "dev-lab-01";

function connectDevice(tracked = false) {
  const sent: unknown[] = [];
  const register = tracked ? registerTrackedDeviceSocket : registerDeviceSocket;
  const stop = register(device, {
    send: (data) => sent.push(JSON.parse(String(data))),
    ready: () => true,
  });
  return { sent, stop };
}

function deviceRow(db: ReturnType<typeof resetDbForTests>, id = device) {
  return db.prepare("SELECT * FROM devices WHERE id = ?").get(id) as Record<string, string>;
}

beforeEach(() => {
  disableRepoVersionManifest();
});

afterEach(() => {
  resetVersionEnv();
  resetRealtimeForTests();
  resetDbForTests(":memory:");
});

describe("offline update queueing", () => {
  it("queues the push for offline devices instead of failing with 409", () => {
    const db = resetDbForTests(":memory:");
    process.env.PRIVGATE_VERSION = "9.9.9";
    const result = requestAgentUpdate(db, device, "ada@contoso.test");
    expect(result).toMatchObject({ ok: true, queued: true, version: "9.9.9" });

    const row = deviceRow(db);
    expect(row.update_requested_at).not.toBe("");
    expect(row.agent_version).toBe(""); // no optimistic marker until served

    const queued = listAudit(db).filter((e) => e.action === "device.update.queued");
    expect(queued).toHaveLength(1);
    expect(queued[0]?.actor).toBe("ada@contoso.test");
  });

  it("still rejects same-version pushes and unknown devices outright", () => {
    const db = resetDbForTests(":memory:");
    process.env.PRIVGATE_VERSION = "0.2.1";
    expect(requestAgentUpdate(db, "ghost", "ada@contoso.test")).toMatchObject({ ok: false, status: 404 });

    setDeviceAgentVersion(db, device, "0.2.1");
    const before = deviceRow(db).update_requested_at;
    expect(requestAgentUpdate(db, device, "ada@contoso.test")).toMatchObject({
      ok: false,
      status: 409,
      error: "already on 0.2.1",
    });
    expect(deviceRow(db).update_requested_at).toBe(before); // nothing queued
  });

  it("serves a queued update on reconnect and clears the request", () => {
    const db = resetDbForTests(":memory:");
    process.env.PRIVGATE_VERSION = "9.9.9";
    expect(requestAgentUpdate(db, device, "ada@contoso.test")).toMatchObject({ ok: true, queued: true });

    const { sent, stop } = connectDevice(true);
    expect(sent).toHaveLength(1);
    const push = sent[0] as { type: string; version?: string };
    expect(push.type).toBe("agent-update");
    expect(push.version).toBe("9.9.9");

    const row = deviceRow(db);
    expect(row.update_requested_at).toBe("");
    expect(parsePendingMarker(row.agent_version)).toEqual({ version: "9.9.9", pushedAt: expect.any(Number) });

    const pushed = listAudit(db).filter((e) => e.action === "device.update.pushed");
    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.actor).toBe("system:update-queue");
    stop();
  });

  it("clears a satisfied queue silently on reconnect without pushing", () => {
    const db = resetDbForTests(":memory:");
    process.env.PRIVGATE_VERSION = "9.9.9";
    setDeviceUpdateRequestedAt(db, device, new Date().toISOString());
    setDeviceAgentVersion(db, device, "9.9.9");

    const { sent, stop } = connectDevice(true);
    expect(sent).toHaveLength(0);
    expect(deviceRow(db).update_requested_at).toBe("");

    const pushes = listAudit(db).filter((e) => e.action === "device.update.pushed");
    expect(pushes).toHaveLength(0);
    stop();
  });

  it("keeps the queue when reconnect serves no live socket", () => {
    const db = resetDbForTests(":memory:");
    process.env.PRIVGATE_VERSION = "9.9.9";
    setDeviceUpdateRequestedAt(db, device, new Date().toISOString());
    expect(drainQueuedUpdateOnReconnect(db, device)).toBe(false);
    expect(deviceRow(db).update_requested_at).not.toBe("");
  });

  it("drains the queue on the next version-report after coming online", () => {
    const db = resetDbForTests(":memory:");
    process.env.PRIVGATE_VERSION = "9.9.9";
    requestAgentUpdate(db, device, "ada@contoso.test");

    const { sent, stop } = connectDevice();
    handleAgentRpc(device, { id: "1", type: "version-report", version: "1.0.0" });
    expect(sent).toHaveLength(1);

    const row = deviceRow(db);
    expect(row.update_requested_at).toBe("");
    expect(parsePendingMarker(row.agent_version)?.version).toBe("9.9.9");

    // Completing the push resolves everything.
    handleAgentRpc(device, { id: "2", type: "version-report", version: "9.9.9" });
    expect(listAudit(db).some((e) => e.action === "device.update.completed")).toBe(true);
    expect(deviceRow(db).agent_version).toBe("9.9.9");
    stop();
  });
});

describe("stuck-update reconciliation", () => {
  it("audits completion when the reported version reaches the push target", () => {
    const db = resetDbForTests(":memory:");
    process.env.PRIVGATE_VERSION = "9.9.9";
    const { stop } = connectDevice();
    expect(requestAgentUpdate(db, device, "ada@contoso.test").ok).toBe(true);

    const reply = handleAgentRpc(device, { id: "3", type: "version-report", version: "9.9.9" });
    expect(reply.ok).toBe(true);
    expect(deviceRow(db).agent_version).toBe("9.9.9");
    const completed = listAudit(db).filter((e) => e.action === "device.update.completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]?.actor).toBe(`device:${device}`);
    stop();
  });

  it("flags a pending push as stale once it outlives 30 minutes", () => {
    const db = resetDbForTests(":memory:");
    process.env.PRIVGATE_VERSION = "9.9.9";
    const oldPush = Date.now() - 31 * 60_000;
    setDeviceAgentVersion(db, device, pendingMarker("9.9.9", oldPush));

    handleAgentRpc(device, { id: "4", type: "version-report", version: "1.0.0" });
    const row = deviceRow(db);
    expect(row.agent_version).toBe(`9.9.9+stale@${oldPush}`);
    const stale = listAudit(db).filter((e) => e.action === "device.update.stale");
    expect(stale).toHaveLength(1);
    expect(stale[0]?.target).toBe(device);

    // Repeated reports must not spam duplicate stale audits.
    handleAgentRpc(device, { id: "5", type: "version-report", version: "1.0.0" });
    expect(listAudit(db).filter((e) => e.action === "device.update.stale")).toHaveLength(1);
  });

  it("leaves young and legacy pending markers alone", () => {
    const db = resetDbForTests(":memory:");
    process.env.PRIVGATE_VERSION = "9.9.9";

    reconcileReportedVersion(db, device, "1.0.0"); // plain storage, no marker yet
    setDeviceAgentVersion(db, device, pendingMarker("9.9.9")); // fresh push
    handleAgentRpc(device, { id: "6", type: "version-report", version: "1.0.0" });
    expect(parsePendingMarker(deviceRow(db).agent_version)).toMatchObject({ version: "9.9.9" });

    setDeviceAgentVersion(db, device, "9.9.9+pending"); // legacy format, no epoch
    handleAgentRpc(device, { id: "7", type: "version-report", version: "1.0.0" });
    expect(deviceRow(db).agent_version).toBe("9.9.9+pending");
    expect(listAudit(db).filter((e) => e.action === "device.update.stale")).toHaveLength(0);
  });

  it("stores sanitized versions so markers keep comparing clean", () => {
    const db = resetDbForTests(":memory:");
    handleAgentRpc(device, { id: "8", type: "version-report", version: "v1.4.2+build.7" });
    expect(deviceRow(db).agent_version).toBe("1.4.2");
    expect(sanitizeClientVersion(pendingMarker("9.9.9", 1730000000000))).toBe("9.9.9");
  });
});

describe("last_seen tracking", () => {
  it("stamps last_seen_at on tracked socket connect and close", async () => {
    const db = resetDbForTests(":memory:");
    expect(deviceRow(db).last_seen_at).toBe("");

    const { stop } = connectDevice(true);
    const connectedAt = deviceRow(db).last_seen_at;
    expect(connectedAt).not.toBe("");
    expect(new Date(connectedAt).getTime()).toBeGreaterThan(Date.now() - 5000);

    // A later close must refresh the stamp even if the value went stale.
    await new Promise((resolve) => setTimeout(resolve, 5));
    db.prepare("UPDATE devices SET last_seen_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(device);
    stop();
    expect(new Date(deviceRow(db).last_seen_at).getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it("does not touch last_seen through the raw bus registration", () => {
    const db = resetDbForTests(":memory:");
    const { stop } = connectDevice(false);
    expect(deviceRow(db).last_seen_at).toBe("");
    stop();
  });
});
