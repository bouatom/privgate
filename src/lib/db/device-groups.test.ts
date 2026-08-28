import { afterEach, describe, expect, it } from "vitest";
import { enrollDevice, resetDbForTests } from "./index";
import { DEMO_DEVICE_ID } from "./seed";
import { deviceSecretKey } from "../secrets";
import {
  addGroupMembers,
  createDeviceGroup,
  deleteDeviceGroup,
  getDeviceGroup,
  getDeviceGroupByName,
  groupsWithPolicyForDevice,
  listDeviceGroups,
  removeGroupMembers,
  renameDeviceGroup,
  setDeviceGroupPolicy,
  setDeviceUpdatePolicy,
} from "./device-groups";

function makeDevice(db: ReturnType<typeof resetDbForTests>, hostname: string): string {
  return enrollDevice(db, hostname, "hybrid", deviceSecretKey()).id;
}

afterEach(() => resetDbForTests(":memory:"));

describe("device group CRUD", () => {
  it("creates, lists, renames, and deletes a group", () => {
    const db = resetDbForTests(":memory:");
    const group = createDeviceGroup(db, "Finance", 5);
    expect(group.name).toBe("Finance");
    expect(group.priority).toBe(5);

    expect(listDeviceGroups(db).map((g) => g.name)).toContain("Finance");

    const rename = renameDeviceGroup(db, group.id, { name: "Finance UK" });
    expect(rename.ok).toBe(true);
    expect(getDeviceGroup(db, group.id)?.name).toBe("Finance UK");

    const del = deleteDeviceGroup(db, group.id);
    expect(del.ok).toBe(true);
    expect(getDeviceGroup(db, group.id)).toBeUndefined();
  });

  it("renames reject a duplicate name", () => {
    const db = resetDbForTests(":memory:");
    createDeviceGroup(db, "A");
    const b = createDeviceGroup(db, "B");
    expect(renameDeviceGroup(db, b.id, { name: "a" }).ok).toBe(false);
  });

  it("find by name is case-insensitive", () => {
    const db = resetDbForTests(":memory:");
    createDeviceGroup(db, "Finance");
    expect(getDeviceGroupByName(db, "finance")?.name).toBe("Finance");
  });
});

describe("membership add/remove", () => {
  it("adds then removes devices, ignoring unknowns", () => {
    const db = resetDbForTests(":memory:");
    const group = createDeviceGroup(db, "Lab");
    const d1 = makeDevice(db, "pc-01");
    const d2 = makeDevice(db, "pc-02");

    expect(addGroupMembers(db, group.id, [d1, d2, "no-such-device"])).toBe(2);
    // Adding the same device again is idempotent.
    expect(addGroupMembers(db, group.id, [d1])).toBe(0);
    expect(getDeviceGroup(db, group.id)?.deviceIds).toEqual(expect.arrayContaining([d1, d2]));

    expect(removeGroupMembers(db, group.id, [d1])).toBe(1);
    expect(getDeviceGroup(db, group.id)?.deviceIds).not.toContain(d1);
  });
});

describe("groupsWithPolicyForDevice", () => {
  it("orders high-priority first and only returns groups with a policy", () => {
    const db = resetDbForTests(":memory:");
    const low = createDeviceGroup(db, "g-low", 1);
    addGroupMembers(db, low.id, [DEMO_DEVICE_ID]);
    const high = createDeviceGroup(db, "g-high", 20);
    setDeviceGroupPolicy(db, high.id, { mode: "manual" });
    addGroupMembers(db, high.id, [DEMO_DEVICE_ID]);
    const unset = createDeviceGroup(db, "g-unset", 99);
    addGroupMembers(db, unset.id, [DEMO_DEVICE_ID]);

    const groups = groupsWithPolicyForDevice(db, DEMO_DEVICE_ID);
    expect(groups.map((g) => g.name)).toEqual(["g-high"]);
  });

  it("sorts equal priorities by name", () => {
    const db = resetDbForTests(":memory:");
    const a = createDeviceGroup(db, "aa", 5);
    setDeviceGroupPolicy(db, a.id, { mode: "auto" });
    addGroupMembers(db, a.id, [DEMO_DEVICE_ID]);
    const b = createDeviceGroup(db, "bb", 5);
    setDeviceGroupPolicy(db, b.id, { mode: "manual" });
    addGroupMembers(db, b.id, [DEMO_DEVICE_ID]);

    const groups = groupsWithPolicyForDevice(db, DEMO_DEVICE_ID);
    expect(groups.map((g) => g.name)).toEqual(["aa", "bb"]);
  });

  it("returns none when the device is not in any policy group", () => {
    const db = resetDbForTests(":memory:");
    expect(groupsWithPolicyForDevice(db, DEMO_DEVICE_ID)).toEqual([]);
  });
});

describe("setDeviceUpdatePolicy", () => {
  it("clears the device policy with empty mode", () => {
    const db = resetDbForTests(":memory:");
    const r = setDeviceUpdatePolicy(db, DEMO_DEVICE_ID, { mode: "" });
    expect(r.ok).toBe(true);
    const row = db.prepare("SELECT update_mode FROM devices WHERE id = ?").get(DEMO_DEVICE_ID) as {
      update_mode: string;
    };
    expect(row.update_mode).toBe("");
  });

  it("rejects unknown devices", () => {
    const db = resetDbForTests(":memory:");
    expect(setDeviceUpdatePolicy(db, "nope", { mode: "auto" }).ok).toBe(false);
  });
});
