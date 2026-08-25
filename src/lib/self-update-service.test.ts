import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listAudit } from "./db";
import { resetDbForTests } from "./db";
import { subscribeConsole } from "./realtime/bus";
import {
  cachedCheck,
  checkForUpdate,
  resetSelfUpdateForTests,
  startUpdateSweep,
  stopUpdateSweep,
} from "./self-update-service";

const INSTALLED_ENV = { PRIVGATE_VERSION: "0.2.1" };

function githubReleasesResponse(releases: unknown, status = 200): Response {
  return new Response(JSON.stringify(releases), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function release(tag: string, prerelease = false) {
  return {
    tag_name: tag,
    prerelease,
    draft: false,
    html_url: `https://github.com/bouatom/privgate/releases/tag/${tag}`,
    assets: [
      { name: `PrivGate-Console-${tag.replace(/^v/, "")}-win-x64.msi`, browser_download_url: "https://x.test/pkg" },
      { name: "sha256sums.txt", browser_download_url: "https://x.test/sums" },
    ],
  };
}

beforeEach(() => {
  resetDbForTests(":memory:");
});

afterEach(() => {
  resetSelfUpdateForTests();
  vi.restoreAllMocks();
});

describe("checkForUpdate", () => {
  it("finds a newer official release and caches it for API + badge", async () => {
    const fetchImpl = vi.fn(async () => githubReleasesResponse([release("0.2.5")]));
    const result = await checkForUpdate({ db: null, fetchImpl, env: INSTALLED_ENV, platform: "windows" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.available).toBe(true);
    expect(result.version).toBe("0.2.5");
    expect(cachedCheck()?.version).toBe("0.2.5");
    expect(cachedCheck()?.assetName).toBe("PrivGate-Console-0.2.5-win-x64.msi");
  });

  it("reports up-to-date when only equal or older releases exist", async () => {
    const result = await checkForUpdate({
      db: null,
      fetchImpl: async () => githubReleasesResponse([release("0.2.1"), release("0.2.0")]),
      env: INSTALLED_ENV,
    });
    expect(result.available).toBe(false);
    expect(result.error).toBeNull();
  });

  it("backs off after a GitHub 403 without burning further requests", async () => {
    const fetchImpl = vi.fn(async () => githubReleasesResponse([], 403));
    const first = await checkForUpdate({ db: null, fetchImpl, env: INSTALLED_ENV, platform: "windows" });
    expect(first.available).toBe(false);
    expect(first.error).toContain("rate limit");

    const second = await checkForUpdate({ db: null, fetchImpl, env: INSTALLED_ENV, platform: "windows" });
    expect(second.error).toContain("rate limit");
    // Cooldown active: the second check must not have touched the network again.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("treats network failure as an error but keeps checking later", async () => {
    let fail = true;
    const fetchImpl = vi.fn(async () => {
      if (fail) throw new Error("ECONNREFUSED");
      return githubReleasesResponse([release("0.3.0")]);
    });
    const failed = await checkForUpdate({ db: null, fetchImpl, env: INSTALLED_ENV, platform: "windows" });
    expect(failed.error).toContain("HTTP 0");
    fail = false;
    const recovered = await checkForUpdate({ db: null, fetchImpl, env: INSTALLED_ENV, platform: "windows" });
    expect(recovered.available).toBe(true);
    expect(recovered.error).toBeNull();
  });

  it("follows the persisted channel from the database", async () => {
    const db = resetDbForTests(":memory:");
    const { setUpdateChannel } = await import("./setup-state");
    setUpdateChannel(db, "nightly");
    const fetchImpl = vi.fn(async () => githubReleasesResponse([release("0.2.9"), release("0.2.11", true)]));
    const result = await checkForUpdate({ db, fetchImpl, env: INSTALLED_ENV, platform: "windows" });
    expect(result.channel).toBe("nightly");
    expect(result.version).toBe("0.2.11");
  });
});

describe("change notification", () => {
  it("publishes SSE once per change and audits each NEW version exactly once", async () => {
    const db = resetDbForTests(":memory:");
    const events: unknown[] = [];
    const unsubscribe = subscribeConsole((event) => events.push(event));

    const fetchImpl = vi.fn(async () => githubReleasesResponse([release("0.2.5")]));
    await checkForUpdate({ db, fetchImpl, env: INSTALLED_ENV, platform: "windows" });
    await checkForUpdate({ db, fetchImpl, env: INSTALLED_ENV, platform: "windows" }); // same verdict → silence

    expect(events).toHaveLength(1);
    let audits = listAudit(db, { action: "console.update.available" });
    expect(audits).toHaveLength(1);

    // A genuinely newer build appears upstream.
    vi.mocked(fetchImpl).mockImplementation(async () => githubReleasesResponse([release("0.2.6")]));
    await checkForUpdate({ db, fetchImpl, env: INSTALLED_ENV, platform: "windows" });
    expect(events).toHaveLength(2);
    audits = listAudit(db, { action: "console.update.available" });
    expect(audits.map((a) => JSON.parse(a.details).version as string).sort()).toEqual(["0.2.5", "0.2.6"]);

    unsubscribe();
  });
});

describe("startUpdateSweep", () => {
  function manualTimers() {
    const timeouts: Array<{ fn: () => void; ms: number }> = [];
    const intervals: Array<{ fn: () => void; ms: number }> = [];
    return {
      timeouts,
      intervals,
      setTimeoutImpl: ((fn: () => void, ms: number) => {
        timeouts.push({ fn, ms });
        return timeouts.length as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      setIntervalImpl: ((fn: () => void, ms: number) => {
        intervals.push({ fn, ms });
        return intervals.length as unknown as ReturnType<typeof setInterval>;
      }) as typeof setInterval,
      clearTimeoutImpl: (() => {}) as typeof clearTimeout,
      clearIntervalImpl: (() => {}) as typeof clearInterval,
    };
  }

  it("runs a delayed boot tick, then repeats on the interval", async () => {
    const t = manualTimers();
    const fetchImpl = vi.fn(async () => githubReleasesResponse([release("0.2.5")]));

    startUpdateSweep({ ...t, db: null, fetchImpl, env: INSTALLED_ENV, bootDelayMs: 100, intervalMs: 600_000 });
    expect(t.timeouts[0].ms).toBe(100);

    t.timeouts[0].fn(); // simulate boot tick firing
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect(t.intervals[0].ms).toBe(600_000);

    t.intervals[0].fn(); // periodic tick
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    stopUpdateSweep();
  });

  it("is disabled by env and refuses to double-start", () => {
    const t = manualTimers();
    startUpdateSweep({ ...t, db: null, env: { ...INSTALLED_ENV, PRIVGATE_DISABLE_SELFUPDATE_SWEEP: "1" } });
    expect(t.timeouts).toHaveLength(0);

    startUpdateSweep({ ...t, db: null, env: INSTALLED_ENV, bootDelayMs: 50, intervalMs: 60_000 });
    startUpdateSweep({ ...t, db: null, env: INSTALLED_ENV, bootDelayMs: 50, intervalMs: 60_000 });
    expect(t.timeouts).toHaveLength(1);
    stopUpdateSweep();

    startUpdateSweep({ ...t, db: null, env: INSTALLED_ENV, bootDelayMs: 10, intervalMs: 10_000 });
    expect(t.timeouts).toHaveLength(2); // restartable after stop
    stopUpdateSweep();
  });
});
