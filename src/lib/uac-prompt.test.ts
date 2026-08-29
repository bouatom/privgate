import { afterEach, describe, expect, it } from "vitest";
import { listAudit, listUacPrompts, resetDbForTests } from "./db";
import { registerDeviceSocket, resetRealtimeForTests } from "./realtime/bus";
import { handleAgentRpc } from "./realtime/rpc";
import { upsertUsers } from "./db/users";
import { uacOutcomeLabel, uacOutcomePill } from "./uac-prompt-label";

const device = "dev-lab-01";
const sid = "S-1-5-21-3623811015-3361044348-30300820-1013";
const diskmgmt = "C:\\Windows\\System32\\diskmgmt.msc";
const hash = "a".repeat(64);

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
  upsertUsers(db, [{ displayName: "Dana Reyes", userPrincipalName: "dana@contoso.test", adSid: sid }]);
  return db;
}

afterEach(() => {
  resetRealtimeForTests();
  resetDbForTests(":memory:");
});

describe("uac-seen rpc", () => {
  it("records a Windows prompt for a known directory user", () => {
    const db = seed();
    const { stop } = connectDevice();
    const res = handleAgentRpc(device, {
      type: "uac-seen",
      userSid: sid,
      filePath: diskmgmt,
      fileHash: hash,
      publisher: "Microsoft Corporation",
    });
    expect(res).toMatchObject({ ok: true });
    const rows = listUacPrompts(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      filePath: diskmgmt,
      fileHash: hash,
      publisher: "Microsoft Corporation",
      count: 1,
      lastOutcome: "prompted",
      hostname: "LAB-W11-01",
    });
    expect(listAudit(db).some((a) => a.action === "device.uac.prompted")).toBe(true);
    stop();
  });

  it("increments count on repeat appearances and does not spam the audit log", () => {
    const db = seed();
    const { stop } = connectDevice();
    const msg = { type: "uac-seen" as const, userSid: sid, filePath: diskmgmt, fileHash: hash };
    handleAgentRpc(device, msg);
    handleAgentRpc(device, msg);
    const rows = listUacPrompts(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(2);
    expect(listAudit(db, { action: "device.uac.prompted" })).toHaveLength(1);
    stop();
  });

  it("does not increment again when the prompt closes after it was already counted", () => {
    const db = seed();
    const { stop } = connectDevice();
    handleAgentRpc(device, { type: "uac-seen", userSid: sid, filePath: diskmgmt, fileHash: hash });
    handleAgentRpc(device, {
      type: "uac-canceled",
      userSid: sid,
      filePath: diskmgmt,
      fileHash: hash,
      publisher: "Microsoft Corporation",
      outcome: "escaped",
    });
    const rows = listUacPrompts(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 1, lastOutcome: "escaped", publisher: "Microsoft Corporation" });
    stop();
  });

  it("rejects unknown directory users", () => {
    seed();
    const { stop } = connectDevice();
    const res = handleAgentRpc(device, {
      type: "uac-seen",
      userSid: "S-1-5-not-a-user",
      filePath: diskmgmt,
    });
    expect(res).toMatchObject({ ok: false, error: "unknown directory user" });
    stop();
  });
});

describe("uac outcome labels", () => {
  it("maps classifier verdicts for the admin tables", () => {
    expect(uacOutcomeLabel("prompted")).toBe("Prompted");
    expect(uacOutcomeLabel("approved-self")).toBe("Approved (user)");
    expect(uacOutcomeLabel("approved-other")).toBe("Approved (other)");
    expect(uacOutcomeLabel("escaped")).toBe("Dismissed");
    expect(uacOutcomePill("approved-self")).toBe("approved");
    expect(uacOutcomePill("prompted")).toBe("pending");
    expect(uacOutcomePill("escaped")).toBe("denied");
  });
});
