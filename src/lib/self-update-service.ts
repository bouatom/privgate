import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { appendAudit, listAudit } from "./db/audit";
import { getDb } from "./db";
import { installedConsoleVersion } from "./console-version";
import { publishConsole } from "./realtime/bus";
import { registerShutdownHook } from "./lifecycle/shutdown";
import { getUpdateChannel } from "./setup-state";
import {
  GITHUB_RELEASES_URL,
  isUpdateAvailable,
  pickLatestForPlatform,
  type GitHubRelease,
  type PlatformKey,
  type UpdateCandidate,
  type UpdateChannel,
} from "./self-update";

/**
 * Self-update CHECK service: asks GitHub for newer console releases, caches
 * the verdict in memory, pushes badge changes over SSE, and runs the periodic
 * sweep — the first server-side interval in this codebase.
 *
 * Failure policy: unauthenticated api.github.com allows ~60 requests/hour/IP.
 * A 403/429 sets a backoff flag; every check returns the cached result without
 * touching the network until the flag expires. Checks NEVER throw into
 * request paths — errors land on the cached snapshot.
 */

export type UpdateCheck = {
  channel: UpdateChannel;
  available: boolean;
  version: string | null;
  url: string | null;
  assetName: string | null;
  sumsUrl: string | null;
  releaseUrl: string;
  prerelease: boolean;
  checkedAt: string | null;
  /** Why no verdict: "rate-limited" | an error message | null. */
  error: string | null;
};

const CHECK_COOLDOWN_MS = 10 * 60_000; // after a GitHub rate limit
const SWEEP_INTERVAL_MS = 6 * 60 * 60_000; // every 6 hours
const BOOT_TICK_DELAY_MS = 45_000; // delayed first tick so boot is never slowed

type SweepGlobals = {
  __privgateSelfUpdate?: {
    cache: UpdateCheck | null;
    rateLimitedUntilMs: number;
    sweepTimer?: ReturnType<typeof setInterval>;
    bootTimer?: ReturnType<typeof setTimeout>;
    clearIntervalImpl?: typeof clearInterval;
    clearTimeoutImpl?: typeof clearTimeout;
  };
};

const globals = globalThis as unknown as SweepGlobals;

function state() {
  globals.__privgateSelfUpdate ??= { cache: null, rateLimitedUntilMs: 0 };
  return globals.__privgateSelfUpdate;
}

/** Read-only snapshot for API + the side-pane badge. Never hits the network. */
export function cachedCheck(): UpdateCheck | null {
  return state().cache;
}

/** Badge payload for console-shell: present only when a newer build is known. */
export function updateBadge(): { version: string; channel: UpdateChannel } | null {
  const check = state().cache;
  if (!check?.available || !check.version) return null;
  return { version: check.version, channel: check.channel };
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

type FetchResult =
  | { ok: true; releases: GitHubRelease[] }
  | { ok: false; status: number; rateLimited: boolean };

async function fetchReleases(fetchImpl: FetchLike): Promise<FetchResult> {
  let res: Response;
  try {
    res = await fetchImpl(GITHUB_RELEASES_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `privgate-console/${installedConsoleVersion()}`,
      },
    });
  } catch {
    return { ok: false, status: 0, rateLimited: false }; // network down → plain error, no backoff
  }
  if (res.status === 403 || res.status === 429) return { ok: false, status: res.status, rateLimited: true };
  if (!res.ok) return { ok: false, status: res.status, rateLimited: false };
  const body = (await res.json().catch(() => null)) as unknown;
  if (!Array.isArray(body)) return { ok: false, status: res.status, rateLimited: false };
  return { ok: true, releases: body as GitHubRelease[] };
}

function candidateToCheck(candidate: UpdateCandidate | null, channel: UpdateChannel, installed: string): UpdateCheck {
  if (!candidate) {
    return {
      channel,
      available: false,
      version: null,
      url: null,
      assetName: null,
      sumsUrl: null,
      releaseUrl: "",
      prerelease: false,
      checkedAt: new Date().toISOString(),
      error: null,
    };
  }
  return {
    channel,
    available: isUpdateAvailable(candidate.version, installed),
    version: candidate.version,
    url: candidate.url,
    assetName: candidate.assetName,
    sumsUrl: candidate.sumsUrl,
    releaseUrl: candidate.releaseUrl,
    prerelease: candidate.prerelease,
    checkedAt: new Date().toISOString(),
    error: null,
  };
}

/**
 * Audit trail fires once per NEW version only — repeated sweeps of the same
 * available build must not flood audit_events.
 */
function hasAnnouncedBefore(db: DatabaseSync, version: string): boolean {
  const events = listAudit(db, { action: "console.update.available", limit: 10 });
  return events.some((event) => {
    try {
      const details = JSON.parse(event.details) as { version?: unknown };
      return details?.version === version;
    } catch {
      return false;
    }
  });
}

function announceIfChanged(db: DatabaseSync | null, previous: UpdateCheck | null, next: UpdateCheck) {
  const changed = !previous || previous.version !== next.version || previous.available !== next.available;
  if (!changed) return;
  // Any open console refreshes its server components → the badge moves live.
  publishConsole("updates");
  if (db && next.available && next.version && !hasAnnouncedBefore(db, next.version)) {
    appendAudit(db, "system:self-update", "console.update.available", next.version, {
      version: next.version,
      channel: next.channel,
      asset: next.assetName,
      prerelease: next.prerelease,
    });
  }
}

export type CheckOptions = {
  force?: boolean;
  db?: DatabaseSync | null;
  fetchImpl?: FetchLike;
  now?: () => number;
  env?: Record<string, string | undefined>;
  /** Injectable host identity (defaults to the running platform/arch). */
  platform?: PlatformKey;
  arch?: string;
};

/**
 * Ask GitHub whether a newer console exists for the persisted channel.
 * While the rate-limit backoff flag is set this performs NO network call and
 * reports the cached verdict (with an explanatory error) — the cooldown
 * protects the shared unauthenticated IP budget for every admin, so even a
 * manual "check now" waits it out.
 */
export async function checkForUpdate(options: CheckOptions = {}): Promise<UpdateCheck> {
  const db = options.db === undefined ? getDb() : options.db;
  const now = options.now ?? Date.now;
  const current = state();

  if (now() < current.rateLimitedUntilMs) {
    const cached = current.cache;
    if (cached) return { ...cached, error: "GitHub rate limit reached; retrying later" };
  }

  const channel = db ? getUpdateChannel(db) : "official";
  const previous = current.cache;
  const result = await fetchReleases(options.fetchImpl ?? fetch);

  if (!result.ok) {
    if (result.rateLimited) current.rateLimitedUntilMs = now() + CHECK_COOLDOWN_MS;
    const error = result.rateLimited ? "GitHub rate limit reached" : `GitHub request failed (HTTP ${result.status})`;
    if (previous) {
      current.cache = { ...previous, checkedAt: new Date().toISOString(), error };
    } else {
      current.cache = {
        channel,
        available: false,
        version: null,
        url: null,
        assetName: null,
        sumsUrl: null,
        releaseUrl: "",
        prerelease: false,
        checkedAt: new Date().toISOString(),
        error,
      };
    }
    return current.cache;
  }

  const installed = installedConsoleVersion(options.env);
  const picked = pickLatestForPlatform(result.releases, {
    channel,
    platform: options.platform,
    arch: options.arch,
  });
  const next = candidateToCheck(picked?.candidate ?? null, channel, installed);
  announceIfChanged(db, previous, next);
  current.cache = next;
  return next;
}

export type SweepDeps = {
  db?: DatabaseSync | null;
  fetchImpl?: FetchLike;
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
  intervalMs?: number;
  bootDelayMs?: number;
  env?: Record<string, string | undefined>;
};

/**
 * Starts the periodic sweep: one delayed tick shortly after boot, then every
 * six hours. Env-disabled with PRIVGATE_DISABLE_SELFUPDATE_SWEEP=1 and fully
 * injectable so tests can drive time manually. Idempotent per process.
 */
export function startUpdateSweep(deps: SweepDeps = {}): void {
  const s = state();
  if (s.sweepTimer || s.bootTimer) return; // already running
  const env = deps.env ?? process.env;
  if ((env.PRIVGATE_DISABLE_SELFUPDATE_SWEEP || "").trim() === "1") return;

  const setIntervalImpl = deps.setIntervalImpl ?? setInterval.bind(globalThis);
  const clearIntervalImpl = deps.clearIntervalImpl ?? clearInterval.bind(globalThis);
  const setTimeoutImpl = deps.setTimeoutImpl ?? setTimeout.bind(globalThis);
  const clearTimeoutImpl = deps.clearTimeoutImpl ?? clearTimeout.bind(globalThis);
  const intervalMs =
    deps.intervalMs ?? (Number.parseInt(env.PRIVGATE_UPDATE_SWEEP_INTERVAL_MS || "", 10) || SWEEP_INTERVAL_MS);
  const bootDelayMs = deps.bootDelayMs ?? BOOT_TICK_DELAY_MS;

  const tick = async () => {
    try {
      await checkForUpdate({ db: deps.db, fetchImpl: deps.fetchImpl, env: deps.env });
    } catch {
      /* checks never break the process that hosts them */
    }
  };

  s.bootTimer = setTimeoutImpl(() => {
    void tick();
    s.bootTimer = undefined;
    s.sweepTimer = setIntervalImpl(() => void tick(), intervalMs);
  }, bootDelayMs);
  s.clearIntervalImpl = clearIntervalImpl;
  s.clearTimeoutImpl = clearTimeoutImpl;

  registerShutdownHook("self-update-sweep", stopUpdateSweep);
}

export function stopUpdateSweep(): void {
  const s = state();
  const clear = {
    interval: s.clearIntervalImpl ?? clearInterval.bind(globalThis),
    timeout: s.clearTimeoutImpl ?? clearTimeout.bind(globalThis),
  };
  if (s.sweepTimer) clear.interval(s.sweepTimer);
  if (s.bootTimer) clear.timeout(s.bootTimer);
  s.sweepTimer = undefined;
  s.bootTimer = undefined;
}

/** Test seam: wipe module state between tests. */
export function resetSelfUpdateForTests(): void {
  stopUpdateSweep();
  globals.__privgateSelfUpdate = undefined;
}
