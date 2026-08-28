import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * The agent build this server ships. Must match the MSI ProductVersion so
 * MajorUpgrade treats a pushed update as a newer install (see wxs MajorUpgrade).
 */
export function currentClientVersion(): string {
  return sanitizeClientVersion(getEffectiveVersion());
}

/**
 * Read version from version.json if available, falls back to env, then package.json.
 * PRIVGATE_VERSION_FILE overrides the manifest location (same seam as
 * console-version.ts), e.g. so tests point away from a stray repo-root
 * version.json.
 */
function getEffectiveVersion(): string {
  // 1. version.json (generated at build time)
  const manifestPath =
    process.env.PRIVGATE_VERSION_FILE && process.env.PRIVGATE_VERSION_FILE.trim()
      ? process.env.PRIVGATE_VERSION_FILE.trim()
      : path.join(process.cwd(), "version.json");
  try {
    const versionJson = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (typeof versionJson.version === "string" && versionJson.version.trim()) {
      return versionJson.version.trim();
    }
  } catch {
    // version.json not found, fall through
  }

  // Fallback to PRIVGATE_VERSION env
  if (process.env.PRIVGATE_VERSION) {
    return process.env.PRIVGATE_VERSION;
  }

  // Fallback to package.json
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    if (pkg.version) return pkg.version;
  } catch {
    // ignore
  }

  return "0.2.1";
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

function parseVersionParts(value: string): [number, number, number] {
  const parts = sanitizeClientVersion(value)
    .split(".")
    .map((p) => Number.parseInt(p, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/** True when the device should be offered the update the server can serve. */
export function updateAvailable(deviceVersion: string, availableVersion: string): boolean {
  if (!deviceVersion.trim()) return false; // unknown → never auto-flag; admin decides
  return compareVersions(sanitizeClientVersion(deviceVersion), sanitizeClientVersion(availableVersion)) < 0;
}