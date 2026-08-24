import { createRequire } from "node:module";
import http from "node:http";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const require_ = createRequire(import.meta.url);
const healthCheck = require_(path.resolve(__dirname, "../../../packaging/health-check.cjs")) as {
  healthUrls: (bind: string, webPort: number) => [string, string];
  resolveHealthTargets: (options?: { dataDir?: string; url?: string; env?: Record<string, string> }) => string[];
  pollEndpoint: (
    url: string,
    options: Record<string, unknown>,
  ) => Promise<{ ok: boolean; status: number; url: string; missing?: boolean; error?: string }>;
  probeHealth: (
    urls: string[] | string,
    options?: Record<string, unknown>,
  ) => Promise<{
    ok: boolean;
    status: number;
    url: string;
    elapsedMs: number;
    endpoint?: string;
    fellBackFrom404?: boolean;
    healthzMissing?: boolean;
    error?: string;
  }>;
};

const servers: http.Server[] = [];
afterAll(() => {
  for (const server of servers) server.close();
});

function listenZero(handler: http.RequestListener): Promise<number> {
  const server = http.createServer(handler);
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
  });
}

function fetchCounter(responses: Array<{ status: number } | Error>) {
  const calls: string[] = [];
  let index = 0;
  const impl = (url: string | URL) => {
    calls.push(String(url));
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve({ status: next.status } as Response);
  };
  return { impl, calls };
}

describe("healthz-first probing with legacy fallback", () => {
  it("maps wildcard binds to the /healthz and /setup pair", () => {
    expect(healthCheck.healthUrls("0.0.0.0", 3000)).toEqual([
      "http://127.0.0.1:3000/healthz",
      "http://127.0.0.1:3000/setup",
    ]);
    expect(healthCheck.healthUrls("192.168.1.10", 8080)).toEqual([
      "http://192.168.1.10:8080/healthz",
      "http://192.168.1.10:8080/setup",
    ]);
  });

  it("keeps an explicit --url as the only target", () => {
    expect(
      healthCheck.resolveHealthTargets({ url: "https://console.example.net/health" }),
    ).toEqual(["https://console.example.net/health"]);
    expect(healthCheck.resolveHealthTargets({ env: {} })?.[0]).toBe("http://127.0.0.1:3000/healthz");
  });

  it("succeeds on the primary endpoint without touching the fallback", async () => {
    const probe = fetchCounter([{ status: 200 }]);
    const result = await healthCheck.probeHealth(
      ["http://x/healthz", "http://x/setup"],
      { timeoutMs: 400, intervalMs: 40, fetchImpl: probe.impl },
    );
    expect(result.ok).toBe(true);
    expect(result.endpoint).toBe("healthz");
    expect(probe.calls.every((url) => url === "http://x/healthz")).toBe(true);
  });

  it("retries a 503 primary until it recovers", async () => {
    const probe = fetchCounter([{ status: 503 }, { status: 200 }]);
    const result = await healthCheck.probeHealth(["http://x/healthz"], {
      timeoutMs: 500,
      intervalMs: 40,
      fetchImpl: probe.impl,
    });
    expect(result.ok).toBe(true);
    expect(probe.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("falls back to /setup when /healthz answers 404 on an older install", async () => {
    const probe = fetchCounter([{ status: 404 }, { status: 302 }]);
    const result = await healthCheck.probeHealth(
      ["http://x/healthz", "http://x/setup"],
      { timeoutMs: 400, intervalMs: 40, fetchImpl: probe.impl },
    );
    expect(result.ok).toBe(true);
    expect(result.endpoint).toBe("legacy");
    expect(result.fellBackFrom404).toBe(true);
    expect(result.status).toBe(302);
    expect(probe.calls).toEqual(["http://x/healthz", "http://x/setup"]);
  });

  it("fails when both endpoints are missing or erroring within the budget", async () => {
    const probe = fetchCounter([{ status: 404 }, { status: 503 }]);
    const result = await healthCheck.probeHealth(
      ["http://x/healthz", "http://x/setup"],
      { timeoutMs: 300, intervalMs: 50, fetchImpl: probe.impl },
    );
    expect(result.ok).toBe(false);
    expect(result.healthzMissing).toBe(true);
  });

  it("does not fall back when the primary is down rather than missing", async () => {
    const probe = fetchCounter([new Error("ECONNREFUSED")]);
    const result = await healthCheck.probeHealth(
      ["http://x/healthz", "http://x/setup"],
      { timeoutMs: 250, intervalMs: 50, fetchImpl: probe.impl },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
    expect(probe.calls.every((url) => url === "http://x/healthz")).toBe(true);
  });

  it("proves the fallback end-to-end over real HTTP", async () => {
    const port = await listenZero((req, res) => {
      if ((req.url || "").endsWith("/healthz")) {
        res.statusCode = 404;
        res.end("no route");
        return;
      }
      res.statusCode = 200;
      res.end("setup page");
    });
    const result = await healthCheck.probeHealth(
      [`http://127.0.0.1:${port}/healthz`, `http://127.0.0.1:${port}/setup`],
      { timeoutMs: 5000, intervalMs: 50 },
    );
    expect(result.ok).toBe(true);
    expect(result.fellBackFrom404).toBe(true);
    expect(result.url).toBe(`http://127.0.0.1:${port}/setup`);
  }, 10000);

  it("pollEndpoint reports a definitive miss for 404 immediately", async () => {
    const probe = fetchCounter([{ status: 404 }]);
    const result = await healthCheck.pollEndpoint("http://x/healthz", {
      deadline: Date.now() + 1000,
      intervalMs: 40,
      fetchImpl: probe.impl,
    });
    expect(result.missing).toBe(true);
    expect(probe.calls).toHaveLength(1); // no retry loop on a definitive 404
  });
});
