import { createRequire } from "node:module";
import http from "node:http";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const require_ = createRequire(import.meta.url);
const healthCheck = require_(path.resolve(__dirname, "../../../packaging/health-check.cjs")) as {
  checkHealth: (url: string, options?: Record<string, unknown>) => Promise<{
    ok: boolean;
    status: number;
    url: string;
    elapsedMs: number;
    error?: string;
  }>;
  healthUrl: (bind: string, webPort: number) => string;
  parseEnvFile: (text: string) => Record<string, string>;
  resolveHealthTarget: (options?: { dataDir?: string; url?: string; env?: Record<string, string> }) => string;
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

describe("health check helpers (packaging/health-check.cjs)", () => {
  it("maps wildcard binds to loopback for the health URL", () => {
    expect(healthCheck.healthUrl("0.0.0.0", 3000)).toBe("http://127.0.0.1:3000/setup");
    expect(healthCheck.healthUrl("::", 3001)).toBe("http://127.0.0.1:3001/setup");
    expect(healthCheck.healthUrl("192.168.1.10", 8080)).toBe("http://192.168.1.10:8080/setup");
  });

  it("parses console.env style files", () => {
    expect(healthCheck.parseEnvFile("# comment\nPRIVGATE_WEB_PORT=4040\nQUOTED='x y'\n")).toEqual({
      PRIVGATE_WEB_PORT: "4040",
      QUOTED: "x y",
    });
  });

  it("resolves the target from a data dir's console.env", () => {
    // No real data dir: falls back to env + defaults (web port 3000).
    expect(healthCheck.resolveHealthTarget({ env: {} })).toBe("http://127.0.0.1:3000/setup");
    expect(healthCheck.resolveHealthTarget({ url: "https://console.example.net/" })).toBe(
      "https://console.example.net/",
    );
  });

  it("reports healthy once the console answers with any non-server-error status", async () => {
    const port = await listenZero((_req, res) => {
      res.statusCode = 200;
      res.end("ok");
    });
    const result = await healthCheck.checkHealth(`http://127.0.0.1:${port}/setup`, {
      timeoutMs: 5000,
      intervalMs: 50,
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  }, 10000);

  it("accepts a 302 to the login page — the HTTP stack is serving", async () => {
    const port = await listenZero((_req, res) => {
      res.statusCode = 302;
      res.setHeader("location", "/login");
      res.end();
    });
    const result = await healthCheck.checkHealth(`http://127.0.0.1:${port}/setup`, {
      timeoutMs: 5000,
      intervalMs: 50,
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(302);
  }, 10000);

  it("fails after the timeout while the console answers 503", async () => {
    const port = await listenZero((_req, res) => {
      res.statusCode = 503;
      res.end("starting");
    });
    const result = await healthCheck.checkHealth(`http://127.0.0.1:${port}/setup`, {
      timeoutMs: 250,
      intervalMs: 50,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("503");
  }, 10000);

  it("fails cleanly when nothing listens on the port", async () => {
    const fetchError = new Error("ECONNREFUSED");
    const result = await healthCheck.checkHealth("http://127.0.0.1:9/", {
      timeoutMs: 150,
      intervalMs: 50,
      fetchImpl: vi.fn().mockRejectedValue(fetchError),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });
});
