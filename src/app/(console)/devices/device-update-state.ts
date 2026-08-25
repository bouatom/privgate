/**
 * Per-row agent update state for the fleet table, derived from the summary the
 * devices page already loads. Pure functions so the pill wording and tone stay
 * unit tested without rendering React.
 */
export type DeviceUpdateInput = {
  agentVersion: string;
  updateRequestedAt: string | null;
};

export type UpdateStateKind = "updating" | "failed" | "queued" | "stale" | "current";

export type UpdateState = {
  kind: UpdateStateKind;
  /** Pill text — keeps the long-standing fleet wording verbatim. */
  label: string;
  /** Pill tone class suffix ("pill", "pill pending", "pill active"). */
  tone: "" | "pending" | "active";
};

function parseVersion(version: string): number[] {
  return version
    .replace(/^v/i, "")
    .split(/[-+]/)[0]!
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

/** True when `candidate` is a strictly newer three-part release than `installed`. */
export function isNewer(candidate: string, installed: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(installed);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

/**
 * Maps one device summary to its agent pill:
 * "+pending" build → updating…, "+stale" build → failed, an outstanding update
 * request → queued, an older release than the console → stale arrow, else current.
 * An empty version means the PC never reported one ("v unknown").
 */
export function updateStateFor(device: DeviceUpdateInput, currentVersion: string): UpdateState {
  if (!device.agentVersion) return { kind: "current", label: "v unknown", tone: "" };
  const updating = device.agentVersion.includes("+pending");
  const failed = !updating && device.agentVersion.includes("+stale");
  const queued = !updating && Boolean(device.updateRequestedAt);
  if (updating) return { kind: "updating", label: "updating…", tone: "pending" };
  if (failed) return { kind: "failed", label: "update failed?", tone: "pending" };
  if (queued) return { kind: "queued", label: "update queued", tone: "active" };
  if (isNewer(currentVersion, device.agentVersion)) {
    return { kind: "stale", label: `v${device.agentVersion} → ${currentVersion}`, tone: "pending" };
  }
  return { kind: "current", label: `v${device.agentVersion}`, tone: "active" };
}
