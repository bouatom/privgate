import { afterEach, describe, expect, it } from "vitest";
import { getDb, listAudit, listDeviceSummaries, resetDbForTests } from "./db";
import { createJit } from "./db/jit";
import { upsertUsers } from "./db/users";
import { registerDeviceSocket, resetRealtimeForTests } from "./realtime/bus";
import { expireDueJit } from "./jit-expiry";
import { handleAgentRpc } from "./realtime/rpc";

const device = "dev-lab-01";

function seedEligible() {
  const db = resetDbForTests(":memory:");
  upsertUsers(db, [
    {
      displayName: "Dana Reyes",
      userPrincipalName: "dana@contoso.test",
      adSid: "S-1-5-21-1",
      jitEligible: true,
    },
  ]);
  const user = db.prepare("SELECT id FROM users WHERE upn = ?").get("dana@contoso.test") as { id: string };
  const grant = createJit(db, {
    userId: user.id,
    deviceId: device,
    durationMinutes: 15,
    reason: "printer driver install",
  });
  if ("error" in grant) throw new Error(grant.error);
  return { db, grant };
}

function backdate(grantId: string, minutesAgo = 1) {
  const past = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  getDb().prepare(`UPDATE jit_grants SET expires_at = ? WHERE id = ?`).run(past, grantId);
}

afterEach(() => {
  resetRealtimeForTests();
  resetDbForTests(":memory:");
});

describe("jit expiry", () => {
  it("expires due grants, audits, and pushes jit-revoke to the connected device", () => {
    const { grant } = seedEligible();
    backdate(grant.id);
    const sent: unknown[] = [];
    const stop = registerDeviceSocket(device, {
      send: (data) => sent.push(JSON.parse(String(data))),
      ready: () => true,
    });

    const expired = expireDueJit();
    expect(expired.map((g) => g.id)).toEqual([grant.id]);
    expect(getDb().prepare(`SELECT status FROM jit_grants WHERE id = ?`).get(grant.id)).toMatchObject({
      status: "expired",
    });
    expect(listAudit(getDb()).some((a) => a.action === "jit.expired")).toBe(true);
    expect(sent).toContainEqual(expect.objectContaining({ type: "jit-revoke", grantId: grant.id }));
    stop();
  });

  it("is idempotent once expired", () => {
    const { grant } = seedEligible();
    backdate(grant.id);
    expireDueJit();
    expect(expireDueJit()).toEqual([]);
  });

  it("keeps live windows untouched", () => {
    seedEligible();
    expect(expireDueJit()).toEqual([]);
  });

  it("device summaries no longer count an expired window as active", () => {
    const { grant } = seedEligible();
    backdate(grant.id);
    expireDueJit();
    const row = listDeviceSummaries(getDb()).find((d) => d.id === device);
    expect(row?.activeJit).toBe(0);
  });

  it("agent jit-state rpc reports active:false after a stale window", () => {
    const { grant } = seedEligible();
    backdate(grant.id);
    const res = handleAgentRpc(device, { type: "jit-state", userSid: "S-1-5-21-1" });
    expect(res.ok).toBe(true);
    expect(res.payload).toMatchObject({ active: false });
  });
});
