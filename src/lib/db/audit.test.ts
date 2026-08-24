import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { listAudit, listAuditActions, resetDbForTests } from "./index";

function insertEvent(
  db: ReturnType<typeof resetDbForTests>,
  at: string,
  actor: string,
  action: string,
  target = "req-1",
  details = "{}",
) {
  db.prepare(
    `INSERT INTO audit_events (id, at, actor, action, target, details) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), at, actor, action, target, details);
}

describe("listAudit", () => {
  it("keeps the legacy bare-search-string signature", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    insertEvent(db, "2026-01-01T00:00:00.000Z", "ada@contoso.test", "request.approve", "req-1");
    insertEvent(db, "2026-01-02T00:00:00.000Z", "device:abc", "request.create", "req-2", '{"fileHash":"hash123"}');
    expect(listAudit(db, "hash123").map((e) => e.action)).toEqual(["request.create"]);
    expect(listAudit(db, "ada").map((e) => e.action)).toEqual(["request.approve"]);
    expect(listAudit(db).length).toBe(2);
  });

  it("filters by exact action instead of LIKE-over-details", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    insertEvent(db, "2026-01-01T00:00:00.000Z", "ada", "request.approve", "req-1");
    insertEvent(db, "2026-01-02T00:00:00.000Z", "bob", "request.approve", "req-2");
    insertEvent(db, "2026-01-03T00:00:00.000Z", "cat", "request.deny", "req-3");
    const rows = listAudit(db, { action: "request.approve" });
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.action === "request.approve")).toBe(true);
  });

  it("bounds by inclusive date range", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    insertEvent(db, "2026-01-01T00:00:00.000Z", "a", "x.a");
    insertEvent(db, "2026-02-15T10:00:00.000Z", "b", "x.b");
    insertEvent(db, "2026-03-31T23:59:59.999Z", "c", "x.c");
    const rows = listAudit(db, {
      from: "2026-02-01T00:00:00.000Z",
      to: "2026-03-31T23:59:59.999Z",
    });
    expect(rows.map((r) => r.action).sort()).toEqual(["x.b", "x.c"]);
  });

  it("combines filters and orders newest-first", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    insertEvent(db, "2026-01-01T00:00:00.000Z", "ada", "request.approve", "req-1");
    insertEvent(db, "2026-02-01T00:00:00.000Z", "ada", "request.deny", "req-2");
    insertEvent(db, "2026-03-01T00:00:00.000Z", "bob", "request.approve", "req-3");
    const rows = listAudit(db, { q: "ada", action: "request.approve" });
    expect(rows.map((r) => r.target)).toEqual(["req-1"]);
  });

  it("paginates with limit and offset over newest-first order", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    for (let i = 1; i <= 5; i++) {
      insertEvent(db, `2026-01-0${i}T00:00:00.000Z`, "actor", `action.${i}`);
    }
    expect(listAudit(db, { limit: 2, offset: 0 }).map((r) => r.action)).toEqual(["action.5", "action.4"]);
    expect(listAudit(db, { limit: 2, offset: 2 }).map((r) => r.action)).toEqual(["action.3", "action.2"]);
    expect(listAudit(db, { limit: 2, offset: 4 }).map((r) => r.action)).toEqual(["action.1"]);
    expect(listAudit(db, { limit: 2, offset: 6 })).toEqual([]);
  });

  it("caps the default page at 200 like the previous behavior", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    for (let i = 0; i < 205; i++) {
      const at = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
      insertEvent(db, at, "actor", "bulk.event");
    }
    expect(listAudit(db).length).toBe(200);
    expect(listAudit(db, {}).length).toBe(200);
    expect(listAudit(db, { offset: 200 }).length).toBe(5);
  });
});

describe("listAuditActions", () => {
  it("returns sorted distinct actions for the facet dropdown", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    insertEvent(db, "2026-01-01T00:00:00.000Z", "a", "request.approve");
    insertEvent(db, "2026-01-02T00:00:00.000Z", "b", "jit.grant");
    insertEvent(db, "2026-01-03T00:00:00.000Z", "c", "request.approve");
    expect(listAuditActions(db)).toEqual(["jit.grant", "request.approve"]);
  });
});
