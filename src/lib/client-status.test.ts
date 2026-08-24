import { afterEach, describe, expect, it } from "vitest";
import { listDeviceSummaries, resetDbForTests } from "./db";
import {
  dropClientStatus,
  latestClientStatus,
  registerDeviceSocket,
  resetRealtimeForTests,
  uiStatusFor,
} from "./realtime/bus";
import { handleAgentRpc } from "./realtime/rpc";

const device = "dev-lab-01";

function connectDevice() {
  return registerDeviceSocket(device, {
    send: () => {},
    ready: () => true,
  });
}

afterEach(() => {
  resetRealtimeForTests();
  resetDbForTests(":memory:");
});

describe("client-status rpc", () => {
  it("stores a heartbeat and reports the UI alive for a connected device", () => {
    const db = resetDbForTests(":memory:");
    const stop = connectDevice();
    const res = handleAgentRpc(device, { type: "client-status", uptimeSec: 125, pid: 4242 });
    expect(res).toMatchObject({ id: undefined, type: "result", ok: true });
    expect(latestClientStatus(device)).toMatchObject({ uptimeSec: 125, pid: 4242 });

    // The mapping the devices page performs over DB summaries.
    const online = new Set([device]);
    const summary = listDeviceSummaries(db).map((d) => ({
      ...d,
      online: online.has(d.id),
      ...uiStatusFor(d.id, online.has(d.id)),
    }));
    expect(summary[0]).toMatchObject({ uiAlive: true });
    expect(summary[0]?.uiLastSeenAt).toBeTruthy();
    stop();
  });

  it("reports the UI silent once the socket drops even with a fresh beat", () => {
    resetDbForTests(":memory:");
    const stop = connectDevice();
    handleAgentRpc(device, { type: "client-status", uptimeSec: 30, pid: 99 });
    stop();
    expect(uiStatusFor(device, false)).toMatchObject({ uiAlive: false });
    // The last-seen beat survives disconnect (pruned only by TTL), so the
    // console can still show when the GUI was last known to run.
    expect(uiStatusFor(device, false).uiLastSeenAt).toBeTruthy();
  });

  it("goes stale past the freshness window and prunes past the TTL", () => {
    resetDbForTests(":memory:");
    const stop = connectDevice();
    handleAgentRpc(device, { type: "client-status", uptimeSec: 1, pid: 5 });
    const inSixMinutes = Date.now() + 6 * 60_000;
    expect(uiStatusFor(device, true, inSixMinutes)).toMatchObject({
      uiAlive: false,
      uiLastSeenAt: expect.any(String),
    });
    const inElevenMinutes = Date.now() + 11 * 60_000;
    expect(latestClientStatus(device, inElevenMinutes)).toBeNull();
    expect(uiStatusFor(device, true, inElevenMinutes)).toMatchObject({ uiLastSeenAt: null });
    stop();
  });

  it("never marks a device alive that never sent a beat", () => {
    resetDbForTests(":memory:");
    const stop = connectDevice();
    expect(latestClientStatus(device)).toBeNull();
    expect(uiStatusFor(device, true)).toMatchObject({ uiAlive: false, uiLastSeenAt: null });
    stop();
  });

  it("drops stored state explicitly like a socket close does", () => {
    resetDbForTests(":memory:");
    const stop = connectDevice();
    handleAgentRpc(device, { type: "client-status", uptimeSec: 10, pid: 7 });
    dropClientStatus(device);
    expect(latestClientStatus(device)).toBeNull();
    stop();
  });

  it("rejects malformed numbers without storing anything", () => {
    resetDbForTests(":memory:");
    const stop = connectDevice();
    expect(handleAgentRpc(device, { type: "client-status", uptimeSec: -1, pid: 10 })).toMatchObject({
      ok: false,
      error: "uptimeSec/pid invalid",
    });
    expect(
      handleAgentRpc(device, { type: "client-status", uptimeSec: Number.NaN, pid: 10 }),
    ).toMatchObject({ ok: false });
    expect(handleAgentRpc(device, { type: "client-status", uptimeSec: 5, pid: 0 })).toMatchObject({ ok: false });
    expect(handleAgentRpc(device, { type: "client-status", uptimeSec: 5, pid: -3 })).toMatchObject({ ok: false });
    expect(handleAgentRpc(device, { type: "client-status", uptimeSec: Number.MAX_SAFE_INTEGER + 1, pid: 10 })).toMatchObject({
      ok: false,
    });
    expect(
      handleAgentRpc(device, { type: "client-status", uptimeSec: "120" as unknown as number, pid: 10 }),
    ).toMatchObject({ ok: false });
    expect(latestClientStatus(device)).toBeNull();
    stop();
  });
});
