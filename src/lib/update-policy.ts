import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { groupsWithPolicyForDevice } from "./db/device-groups";

/**
 * Device update policy model.
 *
 * Three modes an admin can choose, applied per device or per group:
 *   - auto      update automatically as soon as a newer build is available
 *   - scheduled only update inside a daily maintenance window (HH:MM)
 *   - manual    never auto-push; the admin updates explicitly
 *
 * Resolution is deterministic and admin-legible (most specific wins):
 *   1. device-level policy (if set)
 *   2. the highest-priority group of the device that sets a policy
 *   3. the platform default (auto)
 */
export type UpdateMode = "auto" | "scheduled" | "manual";

export const UPDATE_MODES: UpdateMode[] = ["auto", "scheduled", "manual"];
export const DEFAULT_UPDATE_MODE: UpdateMode = "auto";

/** Minutes on either side of the scheduled HH:MM treated as the maintenance window. */
export const SCHEDULED_WINDOW_MINUTES = 15;

export type EffectiveUpdatePolicy = {
  mode: UpdateMode;
  /** "HH:MM" daily time when mode === "scheduled"; "" otherwise. */
  schedule: string;
  source: "device" | "group" | "default";
  /** Group name when source === "group". */
  sourceName?: string;
};

export function isUpdateMode(value: string): value is UpdateMode {
  return value === "auto" || value === "scheduled" || value === "manual";
}

/** A tiny shape we only need from a device to resolve its policy. */
export type PolicyDevice = { id: string; updateMode: string; updateSchedule: string };

/** Resolve the effective update policy for a device using the precedence rule above. */
export function effectiveUpdatePolicy(db: DatabaseSync, device: PolicyDevice): EffectiveUpdatePolicy {
  if (isUpdateMode(device.updateMode)) {
    return { mode: device.updateMode, schedule: device.updateSchedule, source: "device" };
  }
  const groups = groupsWithPolicyForDevice(db, device.id);
  if (groups.length) {
    return {
      mode: groups[0].updateMode as UpdateMode,
      schedule: groups[0].updateSchedule,
      source: "group",
      sourceName: groups[0].name,
    };
  }
  return { mode: DEFAULT_UPDATE_MODE, schedule: "", source: "default" };
}

/** Normalize a free-form schedule string to "HH:MM" or "" when invalid. */
export function normalizeSchedule(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!match) return "";
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return "";
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function nowMinutes(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * True when `now` is inside the daily scheduled window for `schedule` ("HH:MM"),
 * i.e. within SCHEDULED_WINDOW_MINUTES of the scheduled minute (wrapping midnight).
 */
export function scheduledWindowDue(schedule: string, now: Date, windowMinutes = SCHEDULED_WINDOW_MINUTES): boolean {
  const m = normalizeSchedule(schedule);
  if (!m) return false;
  const [hh, mm] = m.split(":").map(Number);
  const scheduledMinute = hh * 60 + mm;
  const currentMinute = nowMinutes(now);
  // Allow the window to wrap past midnight.
  const lower = (scheduledMinute - windowMinutes + 1440) % 1440;
  const upper = (scheduledMinute + windowMinutes) % 1440;
  if (lower <= upper) return currentMinute >= lower && currentMinute <= upper;
  return currentMinute >= lower || currentMinute <= upper;
}

/** Convenience for callers that wear a DB + device id. */
export function resolveForDeviceId(db: DatabaseSync, deviceId: string, fallback: PolicyDevice): EffectiveUpdatePolicy {
  return effectiveUpdatePolicy(db, fallback);
}
