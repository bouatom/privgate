/**
 * Version-resolution test seam for client-version.ts / console-version.ts.
 *
 * The version-bump feature writes a build-time `version.json` at repo root,
 * which is the runtime source of truth for the served versions. A stray
 * repo-root manifest must not leak into unit tests that inject
 * PRIVGATE_VERSION and expect it to win. Pointing PRIVGATE_VERSION_FILE at a
 * dedicated empty temp dir (which has no version.json) makes those tests
 * hermetic: resolution falls through to env / package.json.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let dir: string | null = null;

/** Path to a version.json that never exists, inside a private empty temp dir. */
export function missingVersionManifestPath(): string {
  dir ??= mkdtempSync(path.join(tmpdir(), "privgate-ver-empty-"));
  return path.join(dir, "no-version.json");
}

/** Stop resolution (in this process) from reading the repo-root version.json. */
export function disableRepoVersionManifest(): void {
  process.env.PRIVGATE_VERSION_FILE = missingVersionManifestPath();
}

/** Clear the env override and remove the private temp dir. */
export function resetVersionEnv(): void {
  delete process.env.PRIVGATE_VERSION;
  delete process.env.PRIVGATE_VERSION_FILE;
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = null;
  }
}
