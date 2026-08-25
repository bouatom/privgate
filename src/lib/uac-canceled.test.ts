import { afterEach, describe, expect, it } from "vitest";
import { listAudit, resetDbForTests } from "./db";
import { registerDeviceSocket, resetRealtimeForTests } from "./realtime/bus";
import { handleAgentRpc } from "./realtime/rpc";
import { insertRequest, listRequests } from "./db/requests";
import { getUserByUpn, upsertUsers } from "./db/users";

const device = "dev-lab-01";
const sid = "S-1-5-21-3623811015-3361044348-30300820-1013";

function connectDevice() {
  const sent: unknown[] = [];
  const stop = registerDeviceSocket(device, {
    send: (data) => sent.push(JSON.parse(String(data))),
    ready: () => true,
  });
  return { sent, stop };
}

function seed() {
  const db = resetDbForTests(":memory:");
  upsertUsers(db, [
    { displayName: "Dana Reyes", userPrincipalName: "dana@contoso.test", adSid: sid },
  ]);
  return db;
}

afterEach(() => {
  resetRealtimeForTests();
  resetDbForTests(":memory:");
});

describe("uac-canceled rpc", () => {
  it("records a canceled attempt for a known directory user", () => {
    const db = seed();
    const { stop } = connectDevice();
    const res = handleAgentRpc(device, {
      type: "uac-canceled",
      userSid: sid,
      filePath: "C:\\Windows\\System32\\diskmgmt.msc",
      publisher: "Microsoft Corporation",
      fileHash: "a".repeat(64),
    });
    expect(res).toMatchObject({ ok: true });
    const rows = listRequests(db).filter((r) => r.deviceId === device && r.status === "canceled");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      filePath: "C:\\Windows\\System32\\diskmgmt.msc",
      userId: expect.any(String),
    });
    expect(listAudit(db).some((a) => a.action === "device.uac.canceled")).toBe(true);
    stop();
  });

  it("deduplicates repeats of the same program instead of spamming rows", () => {
    const db = seed();
    const { stop } = connectDevice();
    const msg = { type: "uac-canceled" as const, userSid: sid, filePath: "C:\\Tools\\setup.exe" };
    expect(handleAgentRpc(device, msg)).toMatchObject({ ok: true });
    expect(handleAgentRpc(device, msg)).toMatchObject({ ok: true });
    expect(listRequests(db).filter((r) => r.status === "canceled")).toHaveLength(1);
    stop();
  });

  it("rejects unknown directory users like evaluate does", () => {
    seed();
    const { stop } = connectDevice();
    const res = handleAgentRpc(device, {
      type: "uac-canceled",
      userSid: "S-1-5-not-a-user",
      filePath: "C:\\Tools\\setup.exe",
    });
    expect(res).toMatchObject({ ok: false, error: "unknown directory user" });
    stop();
  });

  it("falls back to an unidentified placeholder and drops malformed hashes", () => {
    const db = seed();
    const { stop } = connectDevice();
    handleAgentRpc(device, {
      type: "uac-canceled",
      userSid: sid,
      filePath: "",
      fileHash: "not-a-hash",
    });
    const rows = listRequests(db).filter((r) => r.status === "canceled");
    expect(rows[0]?.filePath).toBe("(unidentified program)");
    expect(rows[0]?.fileHash).toBe("");
    // The placeholder still dedupes so repeated unidentified cancels stay one row.
    handleAgentRpc(device, { type: "uac-canceled", userSid: sid, filePath: "" });
    expect(listRequests(db).filter((r) => r.status === "canceled")).toHaveLength(1);
    stop();
  });

  it("keeps canceled rows out of pending dedupe collisions", () => {
    const db = seed();
    const userId = getUserByUpn(db, "dana@contoso.test")!.id;
    insertRequest(db, {
      userId,
      deviceId: device,
      filePath: "C:\\Tools\\setup.exe",
      fileHash: "",
      publisher: "",
      arguments: "",
    });
    const { stop } = connectDevice();
    handleAgentRpc(device, { type: "uac-canceled", userSid: sid, filePath: "C:\\Tools\\setup.exe" });
    const statuses = listRequests(db)
      .filter((r) => r.filePath === "C:\\Tools\\setup.exe")
      .map((r) => r.status);
    expect(statuses).toContain("pending");
    expect(statuses).toContain("canceled");
    stop();
  });

  it("records approved-self telemetry audit-only with no canceled row", () => {
    const db = seed();
    const { stop } = connectDevice();
    const res = handleAgentRpc(device, {
      type: "uac-canceled",
      userSid: sid,
      filePath: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      outcome: "approved-self",
    });
    expect(res).toMatchObject({ ok: true, payload: { recorded: false } });
    expect(listRequests(db).filter((r) => r.status === "canceled")).toHaveLength(0);
    const approved = listAudit(db, { action: "device.uac.approved" });
    expect(approved).toHaveLength(1);
    expect(JSON.parse(approved[0].details)).toMatchObject({
      filePath: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      outcome: "approved-self",
    });
    // The canceled audit must stay silent for an approval outcome.
    expect(listAudit(db, { action: "device.uac.canceled" })).toHaveLength(0);
    stop();
  });

  it("records approved-other telemetry the same audit-only way", () => {
    const db = seed();
    const { stop } = connectDevice();
    const res = handleAgentRpc(device, {
      type: "uac-canceled",
      userSid: sid,
      filePath: "C:\\Windows\\System32\\diskmgmt.msc",
      outcome: "approved-other",
    });
    expect(res).toMatchObject({ ok: true, payload: { recorded: false } });
    expect(listRequests(db).filter((r) => r.status === "canceled")).toHaveLength(0);
    const approved = listAudit(db, { action: "device.uac.approved" });
    expect(JSON.parse(approved[0].details)).toMatchObject({ outcome: "approved-other" });
    stop();
  });

  it("falls back to the legacy canceled row when the outcome is malformed", () => {
    const db = seed();
    const { stop } = connectDevice();
    for (const outcome of ["approved", "DROP TABLE requests", "approved-self;exit", 42]) {
      handleAgentRpc(device, {
        type: "uac-canceled",
        userSid: sid,
        filePath: "C:\\Tools\\setup.exe",
        // @ts-expect-error exercising runtime validation of a non-enum value
        outcome,
      });
    }
    const rows = listRequests(db).filter((r) => r.status === "canceled");
    // All four malformed outcomes degraded to the legacy path and deduped.
    expect(rows).toHaveLength(1);
    expect(listAudit(db, { action: "device.uac.approved" })).toHaveLength(0);
    stop();
  });

  it("still records escaped and unknown verdicts as canceled rows", () => {
    const db = seed();
    const { stop } = connectDevice();
    handleAgentRpc(device, { type: "uac-canceled", userSid: sid, filePath: "C:\\Tools\\a.exe", outcome: "escaped" });
    handleAgentRpc(device, { type: "uac-canceled", userSid: sid, filePath: "C:\\Tools\\b.exe", outcome: "unknown" });
    const paths = listRequests(db)
      .filter((r) => r.status === "canceled")
      .map((r) => r.filePath)
      .sort();
    expect(paths).toEqual(["C:\\Tools\\a.exe", "C:\\Tools\\b.exe"]);
    stop();
  });
});
