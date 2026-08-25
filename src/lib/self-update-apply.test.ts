import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "./db";
import { listAudit } from "./db";
import { applyConsoleUpdate, buildUpdaterCommand } from "./self-update-apply";
import {
  APPLY_STALE_MS,
  applyPaths,
  parseApplyStatus,
  currentApplyStatus,
  type ApplyState,
} from "./self-update-status";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  resetDbForTests(":memory:");
});

function envFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "privgate-apply-"));
  dirs.push(root);
  return { PRIVGATE_DATA_DIR: root };
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

const ASSET_BODY = "fake-installer-bytes";

function candidate(overrides: Partial<Parameters<typeof applyConsoleUpdate>[0]["candidate"]> = {}) {
  return {
    version: "0.2.13",
    channel: "official" as const,
    assetName: "PrivGate-Console-0.2.13-win-x64.msi",
    url: "https://example.test/installer.msi",
    sumsUrl: "https://example.test/sha256sums.txt",
    releaseUrl: "https://github.com/bouatom/privgate/releases/tag/0.2.13",
    prerelease: false,
    ...overrides,
  };
}

function okFetch() {
  return vi.fn(async (url: string | Request) => {
    const body = String(url).endsWith("sha256sums.txt")
      ? `${sha256(ASSET_BODY)}  PrivGate-Console-0.2.13-win-x64.msi\n`
      : ASSET_BODY;
    return new Response(body, { status: 200 });
  }) as unknown as (url: string, init?: RequestInit) => Promise<Response>;
}

function fakeSpawn(calls: Array<{ file: string; args: string[]; options: Record<string, unknown> }>) {
  return ((file: string, args: string[], options: Record<string, unknown>) => {
    calls.push({ file, args, options });
    return { unref: () => {} };
  }) as never;
}

describe("buildUpdaterCommand", () => {
  it("drives update-server.ps1 with -Installer and -Sha256 on Windows", () => {
    const cmd = buildUpdaterCommand({
      platform: "win32",
      installerPath: "C:\\data\\updates\\x.msi",
      scriptPath: "C:\\Program Files\\PrivGate\\update-server.ps1",
      sha256: "a".repeat(64),
    });
    expect(cmd.file).toBe("powershell.exe");
    expect(cmd.args).toContain("-File");
    expect(cmd.args[cmd.args.indexOf("-Installer") + 1]).toBe("C:\\data\\updates\\x.msi");
    expect(cmd.args[cmd.args.indexOf("-Sha256") + 1]).toBe("a".repeat(64));
  });

  it("drives update-server.sh with --deb/--pkg and --sha256 on POSIX", () => {
    for (const [file, flag] of [
      ["privgate-console_1.0.0_amd64.deb", "--deb"],
      ["PrivGate-Console-1.0.0-macos-arm64.pkg", "--pkg"],
    ] as const) {
      const cmd = buildUpdaterCommand({
        platform: "linux",
        installerPath: `/tmp/u/${file}`,
        scriptPath: "/opt/privgate/update-server.sh",
        sha256: "b".repeat(64),
      });
      expect(cmd.file).toBe("bash");
      expect(cmd.args).toContain(flag);
      expect(cmd.args[cmd.args.indexOf("--sha256") + 1]).toBe("b".repeat(64));
    }
  });
});

describe("parseApplyStatus / currentApplyStatus", () => {
  const state = (startedAt = new Date().toISOString()): ApplyState => ({
    target: "0.2.13",
    asset: "x.msi",
    sha256: "c".repeat(64),
    startedAt,
    logFile: "/tmp/apply.log",
  });

  it("is idle without a state file", () => {
    expect(parseApplyStatus({ state: null, logText: "", nowMs: Date.now() }).phase).toBe("idle");
  });

  it("stays running while no terminal marker has been printed", () => {
    expect(parseApplyStatus({ state: state(), logText: "==> Stopping the console", nowMs: Date.now() }).phase).toBe("running");
  });

  it("recognizes success and failure markers from the updater scripts", () => {
    const success = parseApplyStatus({ state: state(), logText: "==> Update complete.\n", nowMs: Date.now() });
    expect(success.phase).toBe("succeeded");

    const checksumFailure = parseApplyStatus({
      state: state(),
      logText: "error: update-server: checksum mismatch for 'x.msi'",
      nowMs: Date.now(),
    });
    expect(checksumFailure.phase).toBe("failed");
  });

  it("marks an old silent run as stale and keeps the last lines", () => {
    const old = parseApplyStatus({
      state: state(new Date(Date.now() - APPLY_STALE_MS - 1000).toISOString()),
      logText: ["line-one", "", "line-two"].join("\n"),
      nowMs: Date.now(),
    });
    expect(old.phase).toBe("stale");
    expect(old.lastLines).toEqual(["line-one", "line-two"]);
  });

  it("currentApplyStatus reads real disk state", () => {
    const env = envFixture();
    expect(currentApplyStatus(env).phase).toBe("idle");
  });
});

describe("applyConsoleUpdate", () => {
  it("downloads, verifies, audits, and spawns the updater detached", async () => {
    const db = resetDbForTests(":memory:");
    const env = envFixture();
    const spawned: Array<{ file: string; args: string[]; options: Record<string, unknown> }> = [];
    const paths = applyPaths(env);

    const result = await applyConsoleUpdate({
      db,
      actor: "admin@contoso.test",
      candidate: candidate(),
      spawnImpl: fakeSpawn(spawned),
      fetchImpl: okFetch(),
      env,
    });

    expect(result.ok).toBe(true);
    // Detached + output redirected into the data dir log; verified hash passed through.
    expect(spawned).toHaveLength(1);
    expect(spawned[0].options.detached).toBe(true);
    expect(spawned[0].args).toContain(sha256(ASSET_BODY));
    expect(readFileSync(paths.stateFile, "utf8")).toContain("0.2.13");
    expect(readFileSync(paths.logFile, "utf8")).toContain("self-update to 0.2.13");

    const audits = listAudit(db, { action: "console.update.apply" });
    expect(audits).toHaveLength(1);
    expect(audits[0].target).toBe("0.2.13");
  });

  it("aborts BEFORE spawning when the downloaded artifact fails its sums entry", async () => {
    const db = resetDbForTests(":memory:");
    const env = envFixture();
    const spawned: Array<{ file: string; args: string[]; options: Record<string, unknown> }> = [];

    const fetchImpl = vi.fn(async (url: string | Request) =>
      new Response(
        String(url).endsWith("sha256sums.txt")
          ? `${"0".repeat(64)}  PrivGate-Console-0.2.13-win-x64.msi\n`
          : ASSET_BODY,
        { status: 200 },
      ),
    ) as unknown as (url: string, init?: RequestInit) => Promise<Response>;

    const result = await applyConsoleUpdate({
      db,
      actor: "admin@contoso.test",
      candidate: candidate(),
      spawnImpl: fakeSpawn(spawned),
      fetchImpl,
      env,
    });

    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(result.ok ? "" : result.error).toContain("checksum mismatch");
    expect(spawned).toHaveLength(0); // fail closed: nothing was executed
    expect(listAudit(db, { action: "console.update.apply" })).toHaveLength(0);
    // The poisoned download is removed from the work dir.
    expect(sumsFileWasRemoved(env)).toBe(true);
  });

  it("refuses to install a release that does not ship sha256sums.txt at all", async () => {
    const db = resetDbForTests(":memory:");
    const env = envFixture();
    const spawned: Array<{ file: string; args: string[]; options: Record<string, unknown> }> = [];

    const result = await applyConsoleUpdate({
      db,
      actor: "admin@contoso.test",
      candidate: candidate({ sumsUrl: null }),
      spawnImpl: fakeSpawn(spawned),
      fetchImpl: okFetch(),
      env,
    });

    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(spawned).toHaveLength(0);
  });

  it("rejects a second apply while one is already running", async () => {
    const db = resetDbForTests(":memory:");
    const env = envFixture();
    const spawned: Array<{ file: string; args: string[]; options: Record<string, unknown> }> = [];
    const deps = {
      db,
      actor: "admin@contoso.test",
      candidate: candidate(),
      spawnImpl: fakeSpawn(spawned),
      fetchImpl: okFetch(),
      env,
    };

    expect(await applyConsoleUpdate(deps)).toMatchObject({ ok: true });
    const second = await applyConsoleUpdate(deps);
    expect(second).toMatchObject({ ok: false, status: 409 });
    expect(second.ok ? "" : second.error).toContain("already running");
    expect(spawned).toHaveLength(1); // only the first apply spawned
  });

  it("allows a re-apply once the previous run went stale", async () => {
    const env = envFixture();
    const spawned: Array<{ file: string; args: string[]; options: Record<string, unknown> }> = [];
    mkdirSync(path.join(env.PRIVGATE_DATA_DIR!, "updates"), { recursive: true });
    const staleState: ApplyState = {
      target: "0.2.12",
      asset: "old.msi",
      sha256: "d".repeat(64),
      startedAt: new Date(Date.now() - APPLY_STALE_MS * 2).toISOString(),
      logFile: path.join(env.PRIVGATE_DATA_DIR!, "updates", "apply.log"),
    };
    writeFileSync(applyPaths(env).stateFile, JSON.stringify(staleState));

    const result = await applyConsoleUpdate({
      db: null,
      actor: "admin@contoso.test",
      candidate: candidate(),
      spawnImpl: fakeSpawn(spawned),
      fetchImpl: okFetch(),
      env,
      now: () => Date.now(),
    });
    expect(result.ok).toBe(true);
  });
});

function sumsFileWasRemoved(env: { PRIVGATE_DATA_DIR?: string }): boolean {
  try {
    readFileSync(path.join(env.PRIVGATE_DATA_DIR!, "updates", "sha256sums.txt"));
    return false; // still there → cleanup failed
  } catch {
    return true; // gone → cleaned up
  }
}
