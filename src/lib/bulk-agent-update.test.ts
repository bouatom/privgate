import { afterEach, describe, expect, it, vi } from "vitest";
import { listAudit, resetDbForTests, enrollDevice, setDeviceAgentVersion } from "./db";
import { registerDeviceSocket, resetRealtimeForTests } from "./realtime/bus";
import { handleAgentRpc } from "./realtime/rpc";
import { deviceSecretKey } from "./secrets";
import { issueSession } from "./auth";
import { createPortalUser } from "./portal";

const jar = vi.hoisted(() => ({ value: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (jar.value ? { name: "privgate_session", value: jar.value } : undefined),
  }),
}));

import { POST } from "@/app/api/devices/update-bulk/route";

const allowedEmail = "bulk-boss@contoso.test";
const deniedEmail = "jit-only@contoso.test";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/devices/update-bulk", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function login(email: string) {
  jar.value = await issueSession({ email, name: "Test Admin" });
}

afterEach(async () => {
  jar.value = "";
  delete process.env.PRIVGATE_VERSION;
  resetRealtimeForTests();
  resetDbForTests(":memory:");
});

async function seedUsers() {
  const db = resetDbForTests(":memory:");
  const boss = createPortalUser(db, {
    displayName: "Bulk Boss",
    email: allowedEmail,
    kind: "sso",
    roleIds: ["role-master-admin"],
  });
  const operator = createPortalUser(db, {
    displayName: "Jit Only",
    email: deniedEmail,
    kind: "sso",
    roleIds: ["role-jit-operator"],
  });
  if ("error" in boss || "error" in operator) throw new Error("user seeding failed");
  return db;
}

describe("POST /api/devices/update-bulk", () => {
  it("requires an authenticated session", async () => {
    await seedUsers();
    const res = await POST(jsonRequest({ allStale: true }));
    expect(res.status).toBe(401);
  });

  it("forbids sessions without devices.update", async () => {
    await seedUsers();
    await login(deniedEmail); // role-jit-operator lacks devices.update
    const res = await POST(jsonRequest({ allStale: true }));
    expect(res.status).toBe(403);
  });

  it("rejects requests with neither ids nor allStale", async () => {
    await seedUsers();
    await login(allowedEmail);
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error?: string }).error).toContain("ids");
  });

  it("pushes online stale devices, queues offline ones, skips unknown ones", async () => {
    process.env.PRIVGATE_VERSION = "9.9.9";
    const db = await seedUsers(); // single reset+seed: portal users must survive
    const offline = enrollDevice(db, "OFFICE-W11", "hybrid", deviceSecretKey());

    const sent: unknown[] = [];
    const stop = registerDeviceSocket("dev-lab-01", {
      send: (data) => sent.push(JSON.parse(String(data))),
      ready: () => true,
    });
    await login(allowedEmail);

    const res = await POST(
      jsonRequest({ ids: ["dev-lab-01", offline.id, "ghost-device"] }),
    );
    expect(res.status).toBe(200);
    const summary = (await res.json()) as {
      pushed: number;
      queued: Array<{ deviceId: string; version: string }>;
      skipped: Array<{ deviceId: string; reason: string }>;
    };
    expect(summary.pushed).toBe(1);
    expect(summary.queued).toEqual([{ deviceId: offline.id, version: "9.9.9" }]);
    expect(summary.skipped).toHaveLength(1);
    expect(summary.skipped[0]?.deviceId).toBe("ghost-device");
    expect(summary.skipped[0]?.reason).toContain("unknown device");

    expect(sent).toHaveLength(1);
    expect(listAudit(db).filter((e) => e.action === "device.update.pushed")).toHaveLength(1);
    expect(listAudit(db).filter((e) => e.action === "device.update.queued")).toHaveLength(1);
    stop();
  });

  it("allStale targets only online devices that are actually behind", async () => {
    process.env.PRIVGATE_VERSION = "9.9.9";
    const db = await seedUsers(); // single reset+seed: portal users must survive
    const secondDevice = enrollDevice(db, "OFFICE-W11", "hybrid", deviceSecretKey());

    // One online current device and one online stale device.
    setDeviceAgentVersion(db, secondDevice.id, "0.2.1"); // empty version = "unknown", never auto-flagged
    const sent: unknown[] = [];
    const stopCurrent = registerDeviceSocket("dev-lab-01", {
      send: () => {},
      ready: () => true,
    });
    handleAgentRpc("dev-lab-01", { id: "1", type: "version-report", version: "9.9.9" });
    const stopStale = registerDeviceSocket(secondDevice.id, {
      send: (data) => sent.push(JSON.parse(String(data))),
      ready: () => true,
    });

    await login(allowedEmail);
    const res = await POST(jsonRequest({ allStale: true }));
    expect(res.status).toBe(200);
    const summary = (await res.json()) as {
      pushed: number;
      queued: unknown[];
      skipped: Array<{ deviceId: string; reason: string }>;
    };
    expect(summary.pushed).toBe(1);
    expect(summary.queued).toEqual([]);
    expect(summary.skipped).toEqual([]);
    expect(sent).toHaveLength(1);

    // The current device was not selected and nothing was queued anywhere.
    const row = db.prepare("SELECT update_requested_at FROM devices WHERE id = ?").get(secondDevice.id) as {
      update_requested_at: string;
    };
    expect(row.update_requested_at).toBe("");
    stopCurrent();
    stopStale();
  });
});
