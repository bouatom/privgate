import { afterEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "./db";
import { registerDeviceSocket, resetRealtimeForTests } from "./realtime/bus";
import { GET } from "@/app/api/healthz/route";

afterEach(() => {
  delete process.env.PRIVGATE_VERSION;
  resetRealtimeForTests();
  resetDbForTests(":memory:");
});

describe("GET /api/healthz", () => {
  it("answers ok with the database up and no agents connected", async () => {
    resetDbForTests(":memory:");
    process.env.PRIVGATE_VERSION = "9.8.7";
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; db: boolean; agentsOnline: number; version: string };
    expect(body).toEqual({ ok: true, db: true, agentsOnline: 0, version: "9.8.7" });
  });

  it("counts live agent sockets without leaking anything else", async () => {
    resetDbForTests(":memory:");
    const stop = registerDeviceSocket("dev-lab-01", { send: () => {}, ready: () => true });
    const res = await GET();
    const text = JSON.stringify(await res.json());
    expect(text).toContain('"agentsOnline":1');
    // No secrets, paths, or internals in the payload.
    expect(text).not.toContain("secret");
    expect(text).not.toContain(process.cwd());
    stop();
  });

  it("reports unhealthy when the database cannot be opened", async () => {
    const db = resetDbForTests(":memory:");
    // Simulate a broken store without breaking getDb's global handle for others.
    const original = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation(((sql: string) => {
      if (sql === "SELECT 1") throw new Error("disk I/O error");
      return original(sql);
    }) as typeof db.prepare);

    const res = await GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; db: boolean };
    expect(body).toMatchObject({ ok: false, db: false });
    vi.restoreAllMocks();
  });
});
