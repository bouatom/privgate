import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listAudit, resetDbForTests } from "./db";
import { registerDeviceSocket, resetRealtimeForTests } from "./realtime/bus";
import { handleAgentRpc } from "./realtime/rpc";
import { agentUpdateMessage, requestAgentUpdate } from "./agent-update";
import { disableRepoVersionManifest, resetVersionEnv } from "@/test/version-manifest";

const device = "dev-lab-01";

function connectDevice() {
  const sent: unknown[] = [];
  const stop = registerDeviceSocket(device, {
    send: (data) => sent.push(JSON.parse(String(data))),
    ready: () => true,
  });
  return { sent, stop };
}

beforeEach(() => {
  disableRepoVersionManifest();
});

afterEach(() => {
  resetVersionEnv();
  resetRealtimeForTests();
  resetDbForTests(":memory:");
});

describe("requestAgentUpdate", () => {
  it("rejects unknown devices and queues offline ones", () => {
    const db = resetDbForTests(":memory:");
    expect(requestAgentUpdate(db, "no-such-device", "ada@contoso.test")).toMatchObject({
      ok: false,
      status: 404,
    });
    // Offline devices no longer 409 — the update is queued for their next check-in.
    expect(requestAgentUpdate(db, device, "ada@contoso.test")).toMatchObject({
      ok: true,
      queued: true,
    });
  });

  it("refuses to push when the device already reports the served build", () => {
    const db = resetDbForTests(":memory:");
    process.env.PRIVGATE_VERSION = "0.2.1";
    const { stop } = connectDevice();
    handleAgentRpc(device, { id: "1", type: "version-report", version: "0.2.1" });
    expect(requestAgentUpdate(db, device, "ada@contoso.test")).toMatchObject({
      ok: false,
      status: 409,
      error: "already on 0.2.1",
    });
    stop();
  });

  it("pushes the update payload, marks pending, and audits", () => {
    const db = resetDbForTests(":memory:");
    process.env.PRIVGATE_VERSION = "9.9.9";
    const { sent, stop } = connectDevice();

    const result = requestAgentUpdate(db, device, "ada@contoso.test");
    expect(result).toMatchObject({ ok: true, version: "9.9.9" });

    expect(sent).toHaveLength(1);
    const push = sent[0] as { type: string; version?: string; path?: string };
    expect(push.type).toBe("agent-update");
    expect(push.version).toBe("9.9.9");
    expect(push.path).toBe("/api/agent/update/download");

    const events = listAudit(db).filter((e) => e.action === "device.update.pushed");
    expect(events).toHaveLength(1);
    expect(events[0]?.actor).toBe("ada@contoso.test");
    expect(events[0]?.target).toBe(device);

    stop();
  });

  it("exposes the push shape used by the agent handler", () => {
    process.env.PRIVGATE_VERSION = "3.2.1";
    expect(agentUpdateMessage()).toEqual({
      type: "agent-update",
      version: "3.2.1",
      path: "/api/agent/update/download",
    });
  });
});

describe("version-report RPC", () => {
  it("stores the reported agent version on the device", () => {
    const db = resetDbForTests(":memory:");
    const reply = handleAgentRpc(device, { id: "7", type: "version-report", version: "1.4.2" });
    expect(reply).toMatchObject({ id: "7", type: "result", ok: true });
    const row = db.prepare("SELECT agent_version FROM devices WHERE id = ?").get(device) as {
      agent_version: string;
    };
    expect(row.agent_version).toBe("1.4.2");
  });

  it("rejects malformed versions without touching the row", () => {
    const db = resetDbForTests(":memory:");
    for (const bad of ["", "drop table;--", "x".repeat(65)]) {
      const reply = handleAgentRpc(device, { id: "8", type: "version-report", version: bad });
      expect(reply.ok).toBe(false);
    }
    const row = db.prepare("SELECT agent_version FROM devices WHERE id = ?").get(device) as {
      agent_version: string;
    };
    expect(row.agent_version).toBe("");
  });

  it("emits device.update.failed when the device reports an older version after a push", () => {
    const db = resetDbForTests(":memory:");
    process.env.PRIVGATE_VERSION = "9.9.9";
    const { stop } = connectDevice();

    // Push update to the device.
    requestAgentUpdate(db, device, "admin@contoso.test");

    // Device reports back with an older version (update failed).
    handleAgentRpc(device, { id: "10", type: "version-report", version: "1.0.0" });

    const failed = listAudit(db, { action: "device.update.failed" });
    expect(failed).toHaveLength(1);
    expect(failed[0].target).toBe(device);

    // The pending marker is preserved so the UI shows the attempt.
    const row = db.prepare("SELECT agent_version FROM devices WHERE id = ?").get(device) as {
      agent_version: string;
    };
    expect(row.agent_version).toContain("+pending@");

    stop();
  });
});
