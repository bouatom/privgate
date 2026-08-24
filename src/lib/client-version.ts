import "server-only";

/**
 * The agent build this server ships. Must match the MSI ProductVersion so
 * MajorUpgrade treats a pushed update as a newer install (see wxs MajorUpgrade).
 */
export function currentClientVersion(): string {
  return sanitizeClientVersion(process.env.PRIVGATE_VERSION);
}

/** Keep only x[.y[.z]] — mirrors packaging/windows sanitization. */
export function sanitizeClientVersion(raw: unknown): string {
  const cleaned = String(raw ?? "")
    .replace(/^v/i, "")
    .split(/[-+]/)[0]
    .trim();
  const parts = cleaned.split(".").filter((p) => /^\d+$/.test(p));
  if (parts.length === 0) return "0.2.1";
  while (parts.length < 3) parts.push("0");
  return parts.slice(0, 3).join(".");
}

/** -1 when a < b, 0 when equal, 1 when a > b. Numeric per segment. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/** True when the device should be offered the update the server can serve. */
export function updateAvailable(deviceVersion: string, availableVersion: string): boolean {
  if (!deviceVersion.trim()) return false; // unknown → never auto-flag; admin decides
  return compareVersions(sanitizeClientVersion(deviceVersion), sanitizeClientVersion(availableVersion)) < 0;
}

function parseVersionParts(value: string): [number, number, number] {
  const parts = sanitizeClientVersion(value)
    .split(".")
    .map((p) => Number.parseInt(p, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}
