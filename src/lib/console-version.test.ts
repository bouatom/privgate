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
      resolveInstalledVersion({ PRIVGATE_VERSION: "7.8.9" }, { packageJsonPath: "/nonexistent/package.json" }),
    ).toEqual({ version: "7.8.9", source: "env" });
  });

  it("falls back to package.json when manifest and env are absent", () => {
    const pkg = fixture("package.json", '{"name":"privgate","version":"0.2.1"}');
    const result = resolveInstalledVersion(EMPTY_ENV, { packageJsonPath: pkg });
    expect(result).toEqual({ version: "0.2.1", source: "package.json" });
  });

  it("never returns an empty version even when every link is broken", () => {
    const pkg = fixture("package.json", "{oops");
    const result = resolveInstalledVersion(EMPTY_ENV, { packageJsonPath: pkg });
    expect(result.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(result.source).toBe("fallback");
  });
});
