import { createRequire } from "node:module";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

type CheckResult = { ok: boolean; problems: string[]; checked: number };

const require_ = createRequire(import.meta.url);
const artifactCheck = require_(path.resolve(__dirname, "../../../packaging/artifact-check.cjs")) as {
  checkArtifact: (dir: string, options?: { platform?: string }) => CheckResult;
  requiredFiles: (platform?: string) => string[];
  runtimeFile: (platform?: string) => string;
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makePayload(files: Record<string, string | Buffer | null> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "privgate-artifact-"));
  dirs.push(dir);
  const defaults: Record<string, string> = {
    "host.cjs": "x",
    "listen.cjs": "x",
    "listen-config.cjs": "x",
    "graceful-shutdown.cjs": "x",
    "write-env.cjs": "x",
    "startup-validation.cjs": "x",
    "artifact-check.cjs": "x",
    "health-check.cjs": "x",
    "bin/node": "#!/bin/sh",
    ".next/required-server-files.json": JSON.stringify({ config: {} }),
    "agent/dist/PrivGate.Agent.exe": "MZ",
  };
  for (const [relative, content] of Object.entries({ ...defaults, ...files })) {
    if (content === null) continue;
    const abs = path.join(dir, relative);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    if (relative.startsWith("bin/")) chmodSync(abs, 0o755);
  }
  return dir;
}

describe("artifact validation (packaging/artifact-check.cjs)", () => {
  it("accepts a complete payload", () => {
    const result = artifactCheck.checkArtifact(makePayload());
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.checked).toBeGreaterThan(0);
  });

  it("rejects an incomplete payload and lists every problem at once", () => {
    const dir = makePayload({
      "host.cjs": null,
      "agent/dist/PrivGate.Agent.exe": null,
      ".next/required-server-files.json": "{not json",
    });
    const result = artifactCheck.checkArtifact(dir);

    expect(result.ok).toBe(false);
    expect(result.problems).toContain("missing file: host.cjs");
    expect(result.problems).toContain("missing file: agent/dist/PrivGate.Agent.exe");
    expect(result.problems.some((p) => p.includes("required-server-files.json is not valid JSON"))).toBe(true);
  });

  it("catches a standalone manifest without a config object", () => {
    const dir = makePayload({ ".next/required-server-files.json": JSON.stringify({ nope: true }) });
    const result = artifactCheck.checkArtifact(dir);
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("no config object");
  });

  it("requires the platform node runtime (node.exe on Windows, bin/node elsewhere)", () => {
    const posixPayload = makePayload();
    const windowsView = artifactCheck.checkArtifact(posixPayload, { platform: "win32" });
    expect(windowsView.ok).toBe(false);
    expect(windowsView.problems).toContain("missing file: node.exe");

    // bin/node ships with the POSIX payloads, so the same dir is valid there.
    const winPayload = makePayload({ "node.exe": "MZ" });
    expect(artifactCheck.checkArtifact(winPayload, { platform: "win32" }).ok).toBe(true);
    expect(artifactCheck.checkArtifact(posixPayload, { platform: "linux" }).ok).toBe(true);
  });

  it("fails fast when given something that is not a directory", () => {
    const result = artifactCheck.checkArtifact("/nonexistent/privgate-payload");
    expect(result.ok).toBe(false);
    expect(result.checked).toBe(0);
  });

  it("keeps the runtime path consistent with the packaged layout", () => {
    expect(artifactCheck.runtimeFile("win32")).toBe("node.exe");
    expect(artifactCheck.runtimeFile("darwin")).toBe(path.join("bin", "node"));
  });
});
