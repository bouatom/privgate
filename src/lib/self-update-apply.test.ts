import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "./db";
import { listAudit } from "./db";
import { applyConsoleUpdate, buildUpdaterCommand, resolveWindowsPowershell, resumeInterruptedApply } from "./self-update-apply";
import {
  APPLY_STALE_MS,
  UPDATER_START_WINDOW_MS,
  abandonApplyLock,
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
    return { pid: 4242, unref: () => {} };
  }) as never;
}

describe("buildUpdaterCommand", () => {
  it("drives update-server.ps1 with -Installer and -Sha256 on Windows", () => {
    const cmd = buildUpdaterCommand({
      platform: "win32",
      installerPath: "C:\\data\\updates\\x.msi",
      scriptPath: "C:\\Program Files\\PrivGate\\update-server.ps1",
      sha256: "a".repeat(64),
      systemRoot: "C:\\Windows",
    });
    // Absolute interpreter path: a WinSW service can run with a stripped PATH
    // where the bare "powershell.exe" name never resolves and the detached
    // updater silently never starts (prod incident 10.0.2.25).
    expect(cmd.file).toBe(resolveWindowsPowershell("C:\\Windows"));
    expect(cmd.file.toLowerCase()).toContain("windowspowershell\\v1.0\\powershell.exe");
    expect(cmd.args.slice(0, 5)).toEqual(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"]);
    expect(cmd.args[cmd.args.indexOf("-Installer") + 1]).toBe("C:\\data\\updates\\x.msi");
    expect(cmd.args[cmd.args.indexOf("-Sha256") + 1]).toBe("a".repeat(64));
  });

  it("never spawns the bare powershell.exe name even when SystemRoot is unset", () => {
    const cmd = buildUpdaterCommand({
      platform: "win32",
      installerPath: "C:\\d\\x.msi",
      scriptPath: "C:\\Program Files\\PrivGate\\update-server.ps1",
      sha256: "a".repeat(64),
    });
    expect(cmd.file.startsWith("C:\\Windows")).toBe(true); // deterministic fallback
    expect(path.win32.isAbsolute(cmd.file)).toBe(true);
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

  it("stays running while the updater has proven it started (updater start line)", () => {
    const sixMinutesIn = parseApplyStatus({
      state: state(new Date(Date.now() - (UPDATER_START_WINDOW_MS + 60_000)).toISOString()),
      logText: "==> updater start pid=7 ps=5.1.26100\n==> Verifying checksum of x.msi\n",
      nowMs: Date.now(),
    });
    expect(sixMinutesIn.phase).toBe("running");
    expect(sixMinutesIn.hint).toBeNull();
  });

  it("declares a header-only run stale after the updater-start window and points at the log file", () => {
    const headerOnly = "==> PrivGate self-update to 0.2.13 (x.msi)\n==> handing off to updater (pid 4242)\n";

    const fresh = parseApplyStatus({ state: state(), logText: headerOnly, nowMs: Date.now() });
    expect(fresh.phase).toBe("running");

    const quiet = parseApplyStatus({
      state: state(new Date(Date.now() - UPDATER_START_WINDOW_MS - 1000).toISOString()),
      logText: headerOnly,
      nowMs: Date.now(),
    });
    expect(quiet.phase).toBe("stale");
    expect(quiet.hint).toContain("/tmp/apply.log");
    // The handoff line proves the child was launched — copy must say so.
    expect(quiet.hint).toContain("produced no output");
  });

  it("says the updater likely never started when not even a handoff line exists", () => {
    const quiet = parseApplyStatus({
      state: state(new Date(Date.now() - UPDATER_START_WINDOW_MS - 1000).toISOString()),
      logText: "==> PrivGate self-update to 0.2.13 (x.msi)",
      nowMs: Date.now(),
    });
    expect(quiet.phase).toBe("stale");
    expect(quiet.hint).toContain("never started");
  });

  it("treats the updater watchdog timeout as failed", () => {
    const timedOut = parseApplyStatus({
      state: state(),
      logText:
        "==> updater start pid=9 ps=5.1\n" +
        "error: update-server: update timed out after 601s in phase install (last completed: stop)\n",
      nowMs: Date.now(),
    });
    expect(timedOut.phase).toBe("failed");
    expect(timedOut.hint).toContain("/tmp/apply.log");
  });

  it("matches an error: line anywhere in the log, not only at byte 0", () => {
    const res = parseApplyStatus({
      state: state(),
      logText: "==> updater start pid=9\nerror: msiexec exited 1603\n",
      nowMs: Date.now(),
    });
    expect(res.phase).toBe("failed");
  });

  it("currentApplyStatus reads real disk state", () => {
    const env = envFixture();
    expect(currentApplyStatus(env).phase).toBe("idle");
  });

  it("is abandonable when stale or failed, but not while the updater has started", () => {
    const runningNoStart = parseApplyStatus({
      state: state(),
      logText: "==> download start",
      nowMs: Date.now(),
    });
    expect(runningNoStart.abandonable).toBe(true);

    const live = parseApplyStatus({
      state: state(),
      logText: "==> updater start pid=7\n==> Installing",
      nowMs: Date.now(),
    });
    expect(live.abandonable).toBe(false);

    const failed = parseApplyStatus({
      state: state(),
      logText: "error: msiexec exited 1603\n",
      nowMs: Date.now(),
    });
    expect(failed.abandonable).toBe(true);
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
      platform: "linux",
    });

    expect(result.ok).toBe(true);
    // Detached + output redirected into the data dir log; verified hash passed through.
    expect(spawned).toHaveLength(1);
    // Unix: detach so the updater outlives the web process. Windows uses a
    // scheduled task instead (see the win32 handoff test) so this Darwin run
    // always takes the detached-child path.
    expect(spawned[0].options.detached).toBe(true);
    expect(spawned[0].args).toContain(sha256(ASSET_BODY));
    expect(readFileSync(paths.stateFile, "utf8")).toContain("0.2.13");

    // One log tells the whole story: header → download → sums → handoff pid.
    const logText = readFileSync(paths.logFile, "utf8");
    expect(logText).toContain("self-update to 0.2.13");
    expect(logText).toContain(`==> download start https://example.test/installer.msi`);
    expect(logText).toContain(`==> downloaded ${ASSET_BODY.length} bytes in `);
    expect(logText).toContain(`==> sha256 verified ${sha256(ASSET_BODY)}`);
    expect(logText).toContain("==> handing off to updater (pid 4242)");

    // The updater is spawned with an explicit working directory and full env.
    expect(String(spawned[0].options.cwd)).toBeTruthy();
    expect(spawned[0].options.env).toMatchObject({ PRIVGATE_DATA_DIR: env.PRIVGATE_DATA_DIR });

    const audits = listAudit(db, { action: "console.update.apply" });
    expect(audits).toHaveLength(1);
    expect(audits[0].target).toBe("0.2.13");
  });

  it("leaves NO header-only log behind when the updater process cannot be started", async () => {
    const db = resetDbForTests(":memory:");
    const env = envFixture();
    const paths = applyPaths(env);
    const throwingSpawn = (() => {
      throw new Error("spawn ENOENT");
    }) as never;

    const result = await applyConsoleUpdate({
      db,
      actor: "admin@contoso.test",
      candidate: candidate(),
      spawnImpl: throwingSpawn,
      fetchImpl: okFetch(),
      env,
      platform: "linux",
    });

    expect(result).toMatchObject({ ok: false, status: 500 });
    // The exact prod-incident artifact was a log with a single header line and
    // no trace of why — a failed spawn must remove state AND that log.
    expect(() => readFileSync(paths.stateFile)).toThrow();
    expect(() => readFileSync(paths.logFile)).toThrow();
    // The attempt is recorded as both a successful apply (pre-spawn) and a
    // failed apply (spawn error), giving full audit trail visibility.
    expect(listAudit(db, { action: "console.update.apply" })).toHaveLength(1);
    const failedAudits = listAudit(db, { action: "console.update.apply.failed" });
    expect(failedAudits).toHaveLength(1);
    expect(failedAudits[0].target).toBe("0.2.13");
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
      platform: "linux",
    });

    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(result.ok ? "" : result.error).toContain("checksum mismatch");
    expect(spawned).toHaveLength(0); // fail closed: nothing was executed
    // Failed apply attempts are recorded in the audit trail.
    const failedAudits = listAudit(db, { action: "console.update.apply.failed" });
    expect(failedAudits).toHaveLength(1);
    expect(failedAudits[0].target).toBe("0.2.13");
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
      platform: "linux",
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
      platform: "linux" as const,
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
      platform: "linux",
    });
    expect(result.ok).toBe(true);
  });

  it("hands Windows applies to schtasks, not a child of the console service", async () => {
    const env = envFixture();
    const spawned: Array<{ file: string; args: string[]; options: Record<string, unknown> }> = [];
    const runs: Array<{ file: string; args: string[] }> = [];
    const result = await applyConsoleUpdate({
      db: null,
      actor: "admin@contoso.test",
      candidate: candidate(),
      spawnImpl: fakeSpawn(spawned),
      runImpl: async (file, args) => {
        runs.push({ file, args });
        return { code: 0, stderr: "" };
      },
      fetchImpl: okFetch(),
      platform: "win32",
      env: { ...env, SystemRoot: "C:\\Windows" },
    });
    expect(result.ok).toBe(true);
    expect(spawned).toHaveLength(0);
    expect(runs).toHaveLength(2);
    expect(runs[0].file.toLowerCase()).toContain("schtasks.exe");
    expect(runs[0].args).toContain("/Create");
    expect(runs[1].args).toEqual(["/Run", "/TN", "PrivGate-Console-Update"]);
    expect(readFileSync(applyPaths(env).logFile, "utf8")).toContain("via scheduled task PrivGate-Console-Update");
  });

  it("lets an admin abandon a stuck apply that never started the updater", () => {
    const env = envFixture();
    mkdirSync(path.join(env.PRIVGATE_DATA_DIR!, "updates"), { recursive: true });
    const paths = applyPaths(env);
    writeFileSync(
      paths.stateFile,
      JSON.stringify({
        target: "0.3.3",
        asset: "x.exe",
        sha256: "e".repeat(64),
        startedAt: new Date().toISOString(),
        logFile: paths.logFile,
      } satisfies ApplyState),
    );
    writeFileSync(paths.logFile, "==> download start\n==> handing off to updater via scheduled task X\n");
    expect(abandonApplyLock(env)).toEqual({ ok: true });
    expect(currentApplyStatus(env).phase).toBe("idle");
  });

  it("refuses to abandon once the updater has printed its start line", () => {
    const env = envFixture();
    mkdirSync(path.join(env.PRIVGATE_DATA_DIR!, "updates"), { recursive: true });
    const paths = applyPaths(env);
    writeFileSync(
      paths.stateFile,
      JSON.stringify({
        target: "0.3.3",
        asset: "x.exe",
        sha256: "e".repeat(64),
        startedAt: new Date().toISOString(),
        logFile: paths.logFile,
      } satisfies ApplyState),
    );
    writeFileSync(paths.logFile, "==> updater start pid=9 ps=5.1\n==> Installing\n");
    expect(abandonApplyLock(env)).toMatchObject({ ok: false, status: 409 });
  });

  it("re-registers the Windows task when a verified installer is left behind", async () => {
    const env = envFixture();
    const paths = applyPaths(env);
    mkdirSync(paths.workDir, { recursive: true });
    const installerPath = path.join(paths.workDir, "PrivGate-Console-0.2.13-win-x64.msi");
    writeFileSync(installerPath, ASSET_BODY);
    writeFileSync(
      paths.stateFile,
      JSON.stringify({
        target: "0.2.13",
        asset: "PrivGate-Console-0.2.13-win-x64.msi",
        sha256: sha256(ASSET_BODY),
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        logFile: paths.logFile,
      } satisfies ApplyState),
    );
    writeFileSync(paths.logFile, "==> sha256 verified\n==> handing off to updater via scheduled task PrivGate-Console-Update\n");
    const runs: Array<{ file: string; args: string[] }> = [];
    const resumed = await resumeInterruptedApply({
      env,
      platform: "win32",
      runImpl: async (file, args) => {
        runs.push({ file, args });
        return { code: 0, stderr: "" };
      },
    });
    expect(resumed).toBe(true);
    expect(runs).toHaveLength(2);
    expect(readFileSync(paths.logFile, "utf8")).toContain("resume: re-registering");
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
