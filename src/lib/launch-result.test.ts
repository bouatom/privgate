import { afterEach, describe, expect, it } from "vitest";
import { getDb, listAudit, resetDbForTests } from "./db";
import { registerDeviceSocket, resetRealtimeForTests } from "./realtime/bus";
import { handleAgentRpc } from "./realtime/rpc";

const device = "dev-lab-01";

function connectDevice() {
  const sent: unknown[] = [];
  const stop = registerDeviceSocket(device, {
    send: (data) => sent.push(JSON.parse(String(data))),
    ready: () => true,
  });
  return { sent, stop };
}

function seed() {
  return resetDbForTests(":memory:");
}

afterEach(() => {
  resetRealtimeForTests();
  resetDbForTests(":memory:");
});

describe("launch-result rpc", () => {
  it("audits a successful launch as device.launch.succeeded", () => {
    seed();
    const { stop } = connectDevice();
    const res = handleAgentRpc(device, {
      type: "launch-result",
      requestId: "req-123",
      filePath: "C:\\Windows\\System32\\diskmgmt.msc",
      ok: true,
      detail: "",
    });
    expect(res).toMatchObject({ ok: true, payload: { recorded: true } });
    const rows = listAudit(getDb(), "device.launch.succeeded");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: `device:${device}`, target: device });
    expect(JSON.parse(rows[0].details)).toEqual({
      requestId: "req-123",
      filePath: "C:\\Windows\\System32\\diskmgmt.msc",
      detail: "",
    });
    expect(listAudit(getDb(), "device.launch.failed")).toHaveLength(0);
    stop();
  });

  it("audits a failed launch with its detail", () => {
    seed();
    const { stop } = connectDevice();
    const res = handleAgentRpc(device, {
      type: "launch-result",
      requestId: "req-456",
      filePath: "C:\\Tools\\setup.exe",
      ok: false,
      detail: "CreateProcessAsUser failed 2 cmd=\"C:\\Tools\\setup.exe\"",
    });
    expect(res).toMatchObject({ ok: true, payload: { recorded: true } });
    const rows = listAudit(getDb(), "device.launch.failed");
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].details)).toMatchObject({
      requestId: "req-456",
      filePath: "C:\\Tools\\setup.exe",
      detail: "CreateProcessAsUser failed 2 cmd=\"C:\\Tools\\setup.exe\"",
    });
    stop();
  });

  it("rejects a non-boolean ok instead of coercing truthy values", () => {
    seed();
    const { stop } = connectDevice();
    expect(
      handleAgentRpc(device, {
        type: "launch-result",
        filePath: "C:\\Tools\\setup.exe",
        // Cast on purpose: the wire can carry ok:"true"; the RPC must reject it.
        ok: "true",
      } as unknown as Parameters<typeof handleAgentRpc>[1]),
    ).toMatchObject({ ok: false, error: "ok boolean required" });
    expect(
      handleAgentRpc(device, {
        type: "launch-result",
        filePath: "C:\\Tools\\setup.exe",
      } as unknown as Parameters<typeof handleAgentRpc>[1]),
    ).toMatchObject({ ok: false });
    expect(listAudit(getDb(), "device.launch.")).toHaveLength(0);
    stop();
  });

  it("caps oversized strings before they reach the audit log", () => {
    seed();
    const { stop } = connectDevice();
    handleAgentRpc(device, {
      type: "launch-result",
      requestId: "r".repeat(500),
      filePath: "C\\" + "x".repeat(5000),
      ok: false,
      detail: "d".repeat(4000),
    });
    const details = JSON.parse(listAudit(getDb(), "device.launch.failed")[0].details);
    expect(details.requestId).toHaveLength(128);
    expect(details.filePath).toHaveLength(1024); // trimmed + capped
    expect(details.detail).toHaveLength(512);
    stop();
  });

  it("tolerates absent optional fields and empty paths (JIT missing-file case)", () => {
    seed();
    const { stop } = connectDevice();
    const res = handleAgentRpc(device, { type: "launch-result", filePath: "", ok: false });
    expect(res).toMatchObject({ ok: true, payload: { recorded: true } });
    expect(JSON.parse(listAudit(getDb(), "device.launch.failed")[0].details)).toEqual({
      requestId: "",
      filePath: "",
      detail: "",
    });
    stop();
  });
});
