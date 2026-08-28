import { afterEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "./db";
import { DEMO_DEVICE_ID } from "./db/seed";
import {
  addGroupMembers,
  createDeviceGroup,
  setDeviceGroupPolicy,
  setDeviceUpdatePolicy,
} from "./db/device-groups";
import {
  DEFAULT_UPDATE_MODE,
  effectiveUpdatePolicy,
  normalizeSchedule,
  scheduledWindowDue,
  type PolicyDevice,
} from "./update-policy";

const DEVICE: PolicyDevice = { id: DEMO_DEVICE_ID, updateMode: "", updateSchedule: "" };

/** Read the device's current policy columns so resolution sees them. */
function deviceView(db: ReturnType<typeof resetDbForTests>): PolicyDevice {
  const row = db
    .prepare("SELECT update_mode, update_schedule FROM devices WHERE id = ?")
    .get(DEMO_DEVICE_ID) as { update_mode: string; update_schedule: string };
  return { id: DEMO_DEVICE_ID, updateMode: row.update_mode, updateSchedule: row.update_schedule };
}

afterEach(() => {
  delete process.env.PRIVGATE_VERSION;
  resetDbForTests(":memory:");
});

describe("effectiveUpdatePolicy precedence", () => {
  it("device-level policy beats any group policy", () => {
    const db = resetDbForTests(":memory:");
    const g = createDeviceGroup(db, "g-admin");
    setDeviceGroupPolicy(db, g.id, { mode: "scheduled", schedule: "09:00" });
    addGroupMembers(db, g.id, [DEMO_DEVICE_ID]);
    setDeviceUpdatePolicy(db, DEMO_DEVICE_ID, { mode: "auto" });

    const policy = effectiveUpdatePolicy(db, deviceView(db));
    expect(policy).toMatchObject({ mode: "auto", schedule: "", source: "device" });
  });

  it("group policy beats the default when no device policy is set", () => {
    const db = resetDbForTests(":memory:");
    const g = createDeviceGroup(db, "g-manual");
    setDeviceGroupPolicy(db, g.id, { mode: "manual" });
    addGroupMembers(db, g.id, [DEMO_DEVICE_ID]);

    const policy = effectiveUpdatePolicy(db, DEVICE);
    expect(policy).toMatchObject({ mode: "manual", source: "group", sourceName: "g-manual" });
  });

  it("highest-priority group wins among multiple", () => {
    const db = resetDbForTests(":memory:");
    const low = createDeviceGroup(db, "g-low");
    setDeviceGroupPolicy(db, low.id, { mode: "auto" });
    addGroupMembers(db, low.id, [DEMO_DEVICE_ID]);

    const high = createDeviceGroup(db, "g-high", 10);
    setDeviceGroupPolicy(db, high.id, { mode: "scheduled", schedule: "12:30" });
    addGroupMembers(db, high.id, [DEMO_DEVICE_ID]);

    const policy = effectiveUpdatePolicy(db, DEVICE);
    expect(policy).toMatchObject({
      mode: "scheduled",
      schedule: "12:30",
      source: "group",
      sourceName: "g-high",
    });
  });

  it("a group with an unset policy does not override another group", () => {
    const db = resetDbForTests(":memory:");
    const unset = createDeviceGroup(db, "g-unset", 50);
    addGroupMembers(db, unset.id, [DEMO_DEVICE_ID]);

    const set = createDeviceGroup(db, "g-set", 1);
    setDeviceGroupPolicy(db, set.id, { mode: "manual" });
    addGroupMembers(db, set.id, [DEMO_DEVICE_ID]);

    const policy = effectiveUpdatePolicy(db, DEVICE);
    expect(policy).toMatchObject({ mode: "manual", sourceName: "g-set" });
  });

  it("defaults to auto when nothing is set", () => {
    const db = resetDbForTests(":memory:");
    const policy = effectiveUpdatePolicy(db, DEVICE);
    expect(policy).toMatchObject({ mode: DEFAULT_UPDATE_MODE, schedule: "", source: "default" });
  });
});

describe("normalizeSchedule", () => {
  it("accepts and pads valid HH:MM", () => {
    expect(normalizeSchedule("9:05")).toBe("09:05");
    expect(normalizeSchedule("23:59")).toBe("23:59");
    expect(normalizeSchedule(" 00:00 ")).toBe("00:00");
  });
  it("rejects invalid times", () => {
    for (const bad of ["24:00", "12:60", "1:5", "noon", "12", "12:", "", null, 123, ["12:00"]]) {
      expect(normalizeSchedule(bad as never)).toBe("");
    }
  });
});

describe("scheduledWindowDue", () => {
  const at = (h: number, m: number) => new Date(2026, 0, 1, h, m);

  it("is true inside the window", () => {
    // Window around 09:00 is [08:45, 09:15].
    expect(scheduledWindowDue("09:00", at(9, 0))).toBe(true);
    expect(scheduledWindowDue("09:00", at(8, 45))).toBe(true);
    expect(scheduledWindowDue("09:00", at(9, 15))).toBe(true);
  });
  it("is false outside the window", () => {
    expect(scheduledWindowDue("09:00", at(8, 44))).toBe(false);
    expect(scheduledWindowDue("09:00", at(9, 16))).toBe(false);
    expect(scheduledWindowDue("09:00", at(12, 0))).toBe(false);
  });
  it("wraps midnight", () => {
    // Window around 00:05 is [23:50, 00:20].
    expect(scheduledWindowDue("00:05", at(23, 55))).toBe(true);
    expect(scheduledWindowDue("00:05", at(0, 10))).toBe(true);
    expect(scheduledWindowDue("00:05", at(12, 0))).toBe(false);
  });
  it("is never due for a blank/invalid schedule", () => {
    expect(scheduledWindowDue("", at(9, 0))).toBe(false);
    expect(scheduledWindowDue("nope", at(9, 0))).toBe(false);
  });
});
