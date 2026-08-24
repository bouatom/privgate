import { describe, expect, it, vi } from "vitest";
import { presentAudit } from "./present";
import type { AuditEvent } from "./db";

function event(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: "evt-1",
    at: "2026-01-01T00:00:00.000Z",
    actor: "device:1111",
    action: "request.create",
    target: "req-1",
    details: '{"fileHash":"abc"}',
    ...overrides,
  };
}

describe("presentAudit", () => {
  it("resolves device:<uuid> actors to hostnames via the injected resolver", () => {
    const rows = presentAudit([event()], (actor) =>
      actor === "device:1111" ? "WS-042" : null,
    );
    expect(rows[0].actor).toBe("WS-042");
    expect(rows[0].details).toEqual({ fileHash: "abc" });
  });

  it("leaves actors verbatim when the resolver cannot map them", () => {
    const rows = presentAudit([
      event(),
      event({ id: "evt-2", actor: "ada@contoso.test" }),
      event({ id: "evt-3", actor: "device:gone" }),
    ], (actor) => (actor === "device:1111" ? "WS-042" : null));
    expect(rows.map((r) => r.actor)).toEqual(["WS-042", "ada@contoso.test", "device:gone"]);
  });

  it("calls the resolver once per unique actor and keeps working with no resolver", () => {
    const resolve = vi.fn(() => "WS-042");
    presentAudit([event(), event({ id: "evt-2", actor: "device:1111" })], resolve);
    expect(resolve).toHaveBeenCalledTimes(1);

    const plain = presentAudit([event()]);
    expect(plain[0].actor).toBe("device:1111");
    expect(plain[0].details).toEqual({ fileHash: "abc" });
  });
});
