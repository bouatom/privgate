import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { getDb, listAudit, resetDbForTests } from "./db";
import { activeJit, createJit, expireDueGrants, getJit, grantIdentities, listJit, revokeJit } from "./db/jit";
import { replaceGroups } from "./db/directory";
import { upsertUsers } from "./db/users";
import { registerDeviceSocket, resetRealtimeForTests } from "./realtime/bus";
import { expireDueJit } from "./jit-expiry";
import { handleAgentRpc } from "./realtime/rpc";

const device = "dev-lab-01";

function seedDirectory() {
  const db = resetDbForTests(":memory:", { seedDemo: false });
  addDevice(db, device);
  upsertUsers(db, [
    { displayName: "Dana Reyes", userPrincipalName: "dana@contoso.test", adSid: "S-1-5-21-100-1", jitEligible: true },
    { displayName: "Lee Wong", userPrincipalName: "lee@contoso.test", adSid: "S-1-5-21-100-2" },
  ]);
  const idByUpn = (upn: string) =>
    (db.prepare("SELECT id FROM users WHERE upn = ?").get(upn) as { id: string }).id;
  return { db, dana: idByUpn("dana@contoso.test"), lee: idByUpn("lee@contoso.test") };
}

function addDevice(db: DatabaseSync, id: string) {
  db.prepare(
    `INSERT INTO devices (id, hostname, join_type, secret_enc, enrolled_at) VALUES (?, ?, 'hybrid', 'test-enc', ?)`,
  ).run(id, id === device ? "LAB-W11-01" : "LAB-W11-02", new Date().toISOString());
}

function syncGroup(db: ReturnType<typeof seedDirectory>["db"], memberUserIds: string[], id = "g-helpdesk") {
  replaceGroups(db, [{ id, name: "Helpdesk", objectId: "obj-g1", memberUserIds }]);
}

function groupGrant(db: ReturnType<typeof seedDirectory>["db"], groupId = "g-helpdesk") {
  const grant = createJit(db, { groupId, deviceId: device, durationMinutes: 30, reason: "patch window" });
  if ("error" in grant) throw new Error(grant.error);
  return grant;
}

function backdate(grantId: string, minutesAgo = 1) {
  const past = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  getDb().prepare(`UPDATE jit_grants SET expires_at = ? WHERE id = ?`).run(past, grantId);
}

afterEach(() => {
  resetRealtimeForTests();
  resetDbForTests(":memory:", { seedDemo: false });
});

describe("group-based JIT grants", () => {
  it("snapshots membership at grant time and covers members via activeJit", () => {
    const { db, dana, lee } = seedDirectory();
    syncGroup(db, [dana, lee]);
    const grant = groupGrant(db);
    expect(grant.kind).toBe("group");
    expect(grant.memberIds.sort()).toEqual([dana, lee].sort());
    expect(activeJit(db, dana, device)?.id).toBe(grant.id);
    expect(activeJit(db, lee, device)?.id).toBe(grant.id);
  });

  it("keeps revoke/expiry deterministic when the directory churns mid-window", () => {
    const { db, dana, lee } = seedDirectory();
    syncGroup(db, [dana, lee]);
    const grant = groupGrant(db);
    // Directory churns: Lee removed, a brand-new member Pat added.
    upsertUsers(db, [
      { displayName: "Pat Novak", userPrincipalName: "pat@contoso.test", adSid: "S-1-5-21-100-3" },
    ]);
    const pat = (db.prepare("SELECT id FROM users WHERE upn = ?").get("pat@contoso.test") as { id: string }).id;
    syncGroup(db, [dana, pat]);

    // The open window still follows the grant-time snapshot, not live membership.
    expect(activeJit(db, lee, device)?.id).toBe(grant.id);
    expect(activeJit(db, pat, device)).toBeUndefined();
  });

  it("expires a due group grant once via the row-based sweep", () => {
    const { db, dana, lee } = seedDirectory();
    syncGroup(db, [dana, lee]);
    const grant = groupGrant(db);
    backdate(grant.id);
    expect(expireDueGrants(db).map((g) => g.id)).toEqual([grant.id]);
    expect(getJit(db, grant.id)?.status).toBe("expired");
    expect(activeJit(db, dana, device)).toBeUndefined();
  });

  it("pushes jit-revoke per member SID on expiry and audits the group", () => {
    const { db, dana, lee } = seedDirectory();
    syncGroup(db, [dana, lee]);
    const grant = groupGrant(db);
    backdate(grant.id);
    const sent: Array<Record<string, unknown>> = [];
    const stop = registerDeviceSocket(device, {
      send: (data) => sent.push(JSON.parse(String(data))),
      ready: () => true,
    });
    expireDueJit();
    stop();
    const sids = sent
      .filter((m) => m.type === "jit-revoke")
      .map((m) => String(m.userSid))
      .sort();
    expect(sids).toEqual(["S-1-5-21-100-1", "S-1-5-21-100-2"]);
    const audit = listAudit(db).find((a) => a.action === "jit.expired");
    expect(audit?.details).toContain('"members":2');
    expect(audit?.details).toContain("g-helpdesk");
  });

  it("falls back to the group label when no member resolves to a directory row", () => {
    const { db, dana, lee } = seedDirectory();
    syncGroup(db, [dana, lee]);
    const grant = groupGrant(db);
    db.prepare("DELETE FROM users").run();
    backdate(grant.id);
    const sent: Array<Record<string, unknown>> = [];
    const stop = registerDeviceSocket(device, {
      send: (data) => sent.push(JSON.parse(String(data))),
      ready: () => true,
    });
    expireDueJit();
    stop();
    expect(sent).toContainEqual(
      expect.objectContaining({ type: "jit-revoke", grantId: grant.id, userSid: "", group: "g-helpdesk" }),
    );
  });

  it("revokes the whole snapshot at once", () => {
    const { db, dana, lee } = seedDirectory();
    syncGroup(db, [dana, lee]);
    const grant = groupGrant(db);
    revokeJit(db, grant.id, "ada@contoso.test");
    expect(activeJit(db, dana, device)).toBeUndefined();
    expect(activeJit(db, lee, device)).toBeUndefined();
  });

  it("enforces one active grant per group+device pair but allows other devices", () => {
    const { db, dana, lee } = seedDirectory();
    syncGroup(db, [dana, lee]);
    groupGrant(db);
    expect(
      createJit(db, { groupId: "g-helpdesk", deviceId: device, durationMinutes: 15, reason: "dupe" }),
    ).toEqual({ error: "an active JIT window already exists for this group and device" });
    addDevice(db, "dev-lab-02");
    const second = createJit(db, {
      groupId: "g-helpdesk",
      deviceId: "dev-lab-02",
      durationMinutes: 15,
      reason: "other pc",
    });
    expect("error" in second).toBe(false);
  });

  it("treats personal and group coverage as a union and returns the latest expiry", () => {
    const { db, dana, lee } = seedDirectory();
    const personal = createJit(db, { userId: dana, deviceId: device, durationMinutes: 60, reason: "longer" });
    if ("error" in personal) throw new Error(personal.error);
    syncGroup(db, [dana, lee]);
    const group = groupGrant(db); // 30 minutes; coexists with Dana's personal window
    // Both cover Dana: union of access, latest expiring wins. Lee only has the group window.
    expect(activeJit(db, dana, device)?.id).toBe(personal.id);
    expect(activeJit(db, lee, device)?.id).toBe(group.id);
    // A redundant personal window is refused while an active one already covers Dana.
    expect(
      createJit(db, { userId: dana, deviceId: device, durationMinutes: 45, reason: "redundant" }),
    ).toEqual({ error: "an active JIT window already exists for this user and device" });
  });

  it("validates xor targeting, group existence, and non-empty snapshots", () => {
    const { db, dana } = seedDirectory();
    expect(createJit(db, { deviceId: device, durationMinutes: 15, reason: "x" })).toEqual({
      error: "provide exactly one of userId or groupId",
    });
    expect(
      createJit(db, { userId: dana, groupId: "g-helpdesk", deviceId: device, durationMinutes: 15, reason: "x" }),
    ).toEqual({ error: "provide exactly one of userId or groupId" });
    expect(createJit(db, { groupId: "g-nope", deviceId: device, durationMinutes: 15, reason: "x" })).toEqual({
      error: "group not found",
    });
    syncGroup(db, [], "g-empty");
    expect(createJit(db, { groupId: "g-empty", deviceId: device, durationMinutes: 15, reason: "x" })).toEqual({
      error: "group has no members to snapshot",
    });
  });

  it("labels group grants by group name with snapshot size in listJit", () => {
    const { db, dana, lee } = seedDirectory();
    syncGroup(db, [dana, lee]);
    const grant = groupGrant(db);
    const row = listJit(db).find((r) => r.id === grant.id);
    expect(row).toMatchObject({ kind: "group", groupName: "Helpdesk", userName: "Helpdesk", memberCount: 2 });
  });

  it("answers the jit-state RPC for covered members through their SID", () => {
    const { db, dana, lee } = seedDirectory();
    syncGroup(db, [dana, lee]);
    const grant = groupGrant(db);
    const hit = handleAgentRpc(device, { type: "jit-state", userSid: "S-1-5-21-100-2" });
    expect(hit.payload).toMatchObject({ active: true, grant: { id: grant.id, groupId: "g-helpdesk" } });
    const miss = handleAgentRpc(device, { type: "jit-state", userSid: "S-1-5-21-100-999" });
    expect(miss.payload).toMatchObject({ active: false });
    expect(grantIdentities(db, grant).map((i) => i.adSid).sort()).toEqual([
      "S-1-5-21-100-1",
      "S-1-5-21-100-2",
    ]);
  });
});
