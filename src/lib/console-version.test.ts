import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveInstalledVersion } from "./console-version";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(name: string, content: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `privgate-ver-${name.replace(/\W/g, "")}-`));
  dirs.push(dir);
  const file = path.join(dir, name);
  writeFileSync(file, content);
  return file;
}

const EMPTY_ENV = {};

/** A manifest path that never exists: makes tests hermetic against repo-root version.json. */
const NO_MANIFEST = path.join(tmpdir(), "privgate-ver-none", "version.json");

describe("resolveInstalledVersion (manifest → env → package.json)", () => {
  it("prefers a valid version.json manifest over everything", () => {
    const manifest = fixture("version.json", '{"version":"1.2.3"}');
    const result = resolveInstalledVersion(
      { PRIVGATE_VERSION: "9.9.9" },
      { manifestPath: manifest, packageJsonPath: "/nonexistent/package.json" },
    );
    expect(result).toEqual({ version: "1.2.3", source: "manifest" });
  });

  it("strips a leading v and metadata in the manifest", () => {
    const manifest = fixture("version.json", '{"version":"v0.2.13"}');
    expect(resolveInstalledVersion(EMPTY_ENV, { manifestPath: manifest }).version).toBe("0.2.13");
  });

  it("ignores a garbage manifest and falls through to env", () => {
    const brokenJson = fixture("version.json", "{not json");
    const wrongShape = fixture("version.json", '{"version":"beta-nine"}');
    const emptyVersion = fixture("version.json", "{}");
    for (const manifest of [brokenJson, wrongShape, emptyVersion]) {
      expect(resolveInstalledVersion({ PRIVGATE_VERSION: "4.5.6" }, { manifestPath: manifest }).source).toBe("env");
    }
  });

  it("honours PRIVGATE_VERSION when no manifest exists", () => {
    expect(
      resolveInstalledVersion({ PRIVGATE_VERSION: "7.8.9" }, { manifestPath: NO_MANIFEST, packageJsonPath: "/nonexistent/package.json" }),
    ).toEqual({ version: "7.8.9", source: "env" });
  });

  it("falls back to package.json when manifest and env are absent", () => {
    const pkg = fixture("package.json", '{"name":"privgate","version":"0.2.1"}');
    const result = resolveInstalledVersion(EMPTY_ENV, { manifestPath: NO_MANIFEST, packageJsonPath: pkg });
    expect(result).toEqual({ version: "0.2.1", source: "package.json" });
  });

  it("never returns an empty version even when every link is broken", () => {
    const pkg = fixture("package.json", "{oops");
    const result = resolveInstalledVersion(EMPTY_ENV, { manifestPath: NO_MANIFEST, packageJsonPath: pkg });
    expect(result.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(result.source).toBe("fallback");
  });
});

describe("stamping parity: branch builds vs official tags vs nightlies", () => {
  // What each CI flow feeds PRIVGATE_VERSION:
  //   branch push → package.json version, plain ("0.2.2")
  //   refs/tags/vX.Y.Z → tag name minus "v" ("0.2.3")
  //   nightly.yml → plain X.Y.Z even though its TAG carries -n.TS
  // All three must land in version.json as the same shape and resolve
  // identically at runtime.
  it.each([
    ["branch build (package.json)", "0.2.2"],
    ["official tag build (refs/tags/v0.2.3)", "0.2.3"],
    ["nightly build (plain despite vX.Y.Z-n.TS tag)", "0.2.2"],
  ])("%s stamps %s and resolves to exactly that", (_label, stamped) => {
    expect(
      resolveInstalledVersion({ PRIVGATE_VERSION: stamped }, { manifestPath: NO_MANIFEST, packageJsonPath: "/nonexistent/package.json" }),
    ).toEqual({
      version: stamped,
      source: "env",
    });
  });

  it("resolves every stamping flavor through a build.sh-written manifest", () => {
    for (const stamped of ["0.2.2", "0.2.3"]) {
      const manifest = fixture(`version-${stamped.replace(/\./g, "-")}`, `{"version":"${stamped}"}`);
      const result = resolveInstalledVersion({ PRIVGATE_VERSION: "9.9.9-stale-env" }, { manifestPath: manifest });
      expect(result).toEqual({ version: stamped, source: "manifest" });
    }
  });

  it("reduces a prerelease-suffixed manifest entry to its numeric core", () => {
    // Defensive: a future build.sh that stamps the full nightly tag must not
    // make /api/healthz or self-update compare against "0.2.2-n.20260825...".
    const manifest = fixture("version-nightly", '{"version":"0.2.2-n.202608250429"}');
    const result = resolveInstalledVersion(EMPTY_ENV, { manifestPath: manifest });
    expect(result).toEqual({ version: "0.2.2", source: "manifest" });
  });

  it("sanitizes a leaked nightly tag passed via PRIVGATE_VERSION", () => {
    const result = resolveInstalledVersion(
      { PRIVGATE_VERSION: "v0.2.2-n.202608250429" },
      { manifestPath: NO_MANIFEST, packageJsonPath: "/nonexistent/package.json" },
    );
    expect(result).toEqual({ version: "0.2.2", source: "env" });
  });

  it("keeps dev mode (no env) pinned to the source-tree version", () => {
    const pkg = fixture("package.json", '{"name":"privgate","version":"0.2.2"}');
    expect(resolveInstalledVersion(EMPTY_ENV, { manifestPath: NO_MANIFEST, packageJsonPath: pkg })).toEqual({
      version: "0.2.2",
      source: "package.json",
    });
  });
});
