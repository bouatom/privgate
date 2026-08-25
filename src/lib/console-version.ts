import "server-only";
import fs from "node:fs";
import path from "node:path";
import { sanitizeClientVersion } from "./client-version";

/**
 * Single source of truth for the INSTALLED CONSOLE version.
 *
 * Resolution chain (first hit wins):
 *  1. version.json manifest written by packaging/build.sh next to host.cjs
 *     (PRIVGATE_VERSION_FILE overrides the location, e.g. for tests).
 *  2. PRIVGATE_VERSION environment variable (legacy path, still honoured).
 *  3. package.json "version" of the current working directory (dev mode).
 *
 * The manifest exists because env vars survive an upgrade: after a bad swap a
 * process could report the NEW version while running OLD files. The manifest is
 * swapped together with the payload, so what it says is what runs. It is also
 * validated by packaging/artifact-check.cjs before any updater touches files.
 */

export type VersionSource = "manifest" | "env" | "package.json" | "fallback";

export type ResolvedVersion = { version: string; source: VersionSource };

type ResolvePaths = {
  manifestPath?: string;
  packageJsonPath?: string;
};

/**
 * Numeric x.y.z core of a raw version string ("v0.2.13" → "0.2.13"). Null for
 * anything that is not version-shaped, so garbage can never masquerade as a
 * plausible default after sanitization.
 */
function numericCore(raw: string): string | null {
  const match = /^v?(\d+\.\d+(\.\d+)?)([.-].*)?$/i.exec(raw.trim());
  if (!match) return null;
  const parts = match[1].split(".");
  while (parts.length < 3) parts.push("0");
  return parts.join(".");
}

function readManifestVersion(manifestPath: string): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { version?: unknown };
    const raw = typeof parsed?.version === "string" ? parsed.version : "";
    const core = numericCore(raw);
    // A garbage manifest must not win over later links in the chain.
    return core && sanitizeClientVersion(core) === core ? core : null;
  } catch {
    return null;
  }
}

function readPackageJsonVersion(packageJsonPath: string): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
    const raw = typeof parsed?.version === "string" ? parsed.version : "";
    return numericCore(raw);
  } catch {
    return null;
  }
}

/**
 * Pure-ish core so tests can point every link of the chain at fixtures
 * instead of mutating process.cwd().
 */
export function resolveInstalledVersion(
  env: Record<string, string | undefined>,
  paths: ResolvePaths = {},
): ResolvedVersion {
  const manifestPath = paths.manifestPath ?? env.PRIVGATE_VERSION_FILE ?? path.join(process.cwd(), "version.json");
  const fromManifest =
    (Boolean(env.PRIVGATE_VERSION_FILE) || fs.existsSync(manifestPath)) && readManifestVersion(manifestPath);
  if (fromManifest) return { version: fromManifest, source: "manifest" };

  const envRaw = (env.PRIVGATE_VERSION || "").trim();
  if (envRaw) return { version: sanitizeClientVersion(envRaw), source: "env" };

  const pkgPath = paths.packageJsonPath ?? path.join(process.cwd(), "package.json");
  const fromPkg = readPackageJsonVersion(pkgPath);
  if (fromPkg) return { version: fromPkg, source: "package.json" };

  return { version: sanitizeClientVersion(undefined), source: "fallback" };
}

/** Installed console version as x.y.z (never empty; falls back to 0.2.1). */
export function installedConsoleVersion(env: Record<string, string | undefined> = process.env): string {
  return resolveInstalledVersion(env).version;
}

/** Same, plus where the value came from — surfaced in Configuration → Updates. */
export function installedConsoleVersionInfo(
  env: Record<string, string | undefined> = process.env,
): ResolvedVersion {
  return resolveInstalledVersion(env);
}
