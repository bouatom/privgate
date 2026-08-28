import { afterEach, describe, expect, it } from "vitest";
import { enrollDevice, resetDbForTests } from "./db";
import { deviceSecretKey } from "./secrets";
import { resetRealtimeForTests, registerDeviceSocket } from "./realtime/bus";
import { setDeviceUpdatePolicy, createDeviceGroup, setDeviceGroupPolicy, addGroupMembers } from "./db/device-groups";
import { currentClientVersion } from "./client-version";
import { sweepDueDevices } from "./agent-update-sweep";

/** The version the server actually serves in this environment (version.json may win). */
const TARGET = currentClientVersion();
/** A version definitely older than whatever the server serves. */
const STALE = "0.0.1";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** HH:MM of the current wall-clock minute — always inside that device's window. */
function hhmmNow(): string {
  const now = new Date();
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** An HH:MM guaranteed to be at least `minGap` minutes from now (mod 1440). */
function hhmmFarFromNow(minGap = 90): string {
  const now = new Date();
  const target = (now.getHours() * 60 + now.getMinutes() + minGap) % 1440;
  return `${pad(Math.floor(target / 60))}:${pad(target % 60)}`;
}

function addDevice(
  db: ReturnType<typeof resetDbForTests>,
  hostname: string,
  version: string,
  mode = "auto",
  schedule = "",
): string {
  const deviceId = enrollDevice(db, hostname, "hybrid", deviceSecretKey()).id;
  db.prepare("UPDATE devices SET agent_version = ? WHERE id = ?").run(version, deviceId);
  setDeviceUpdatePolicy(db, deviceId, { mode, schedule });
  return deviceId;
}

/** Bring the device online so requestAgentUpdate pushes (not queues). */
function connect(id: string): () => void {
  return registerDeviceSocket(id, {
    send: () => undefined,
    ready: () => true,
  });
}

afterEach(() => {
  resetRealtimeForTests();
  resetDbForTests(":memory:");
});

describe("sweepDueDevices", () => {
  it("pushes an auto device that is stale", () => {
    const db = resetDbForTests(":memory:");
    const dev = addDevice(db, "pc-auto", STALE, "auto");
    const stop = connect(dev);

    const r = sweepDueDevices(db);
    expect(r.scanned).toBeGreaterThan(0);
    expect(r).toMatchObject({ pushed: 1, queued: 0, toUpdate: 1 });

    // Marker set so the auto-push is reflected on the row.
    const row = db.prepare("SELECT agent_version FROM devices WHERE id = ?").get(dev) as {
      agent_version: string;
    };
    expect(row.agent_version).toContain(TARGET);
    stop();
  });

  it("skips manual devices even when stale", () => {
    const db = resetDbForTests(":memory:");
    addDevice(db, "pc-manual", STALE, "manual");

    const r = sweepDueDevices(db);
    expect(r.toUpdate).toBe(0);
  });

  it("skips a scheduled device outside its window and pushes inside it", () => {
    const db = resetDbForTests(":memory:");

    const outside = addDevice(db, "pc-sched-out", STALE, "scheduled", hhmmFarFromNow());
    connect(outside);
    expect(sweepDueDevices(db)).toMatchObject({ toUpdate: 0, pushed: 0 });

    const inside = addDevice(db, "pc-sched-in", STALE, "scheduled", hhmmNow());
    connect(inside);
    expect(sweepDueDevices(db)).toMatchObject({ pushed: 1, queued: 0, toUpdate: 1 });
  });

  it("skips devices already up to date", () => {
    const db = resetDbForTests(":memory:");
    addDevice(db, "pc-current", TARGET, "auto");

    const r = sweepDueDevices(db);
    expect(r.toUpdate).toBe(0);
  });

  it("resolves group policy when the device has none set", () => {
    const db = resetDbForTests(":memory:");

    const deviceId = enrollDevice(db, "pc-grouped", "hybrid", deviceSecretKey()).id;
    db.prepare("UPDATE devices SET agent_version = ? WHERE id = ?").run(STALE, deviceId);
    const grp = createDeviceGroup(db, "g-auto");
    setDeviceGroupPolicy(db, grp.id, { mode: "auto" });
    addGroupMembers(db, grp.id, [deviceId]);
    connect(deviceId);

    expect(sweepDueDevices(db)).toMatchObject({ pushed: 1, toUpdate: 1 });
  });

  it("queues an auto device that is offline", () => {
    const db = resetDbForTests(":memory:");
    addDevice(db, "pc-offline", STALE, "auto"); // no socket

    const r = sweepDueDevices(db);
    expect(r).toMatchObject({ pushed: 0, queued: 1, toUpdate: 1 });
  });
});
