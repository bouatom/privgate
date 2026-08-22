import { describe, expect, it } from "vitest";
import { signTicket, verifyTicket, hmacDevice, type ElevationTicket } from "./signing";

const ticket: ElevationTicket = {
  typ: "elevate",
  sub: "S-1-5-21-1",
  dev: "d1",
  sha256: "abc",
  publisher: "CN=Contoso",
  path: "C:\\\\app.exe",
  child: "deny",
  nbf: 1_000,
  exp: 2_000,
  nonce: "n1",
};

describe("tickets", () => {
  it("round-trips HMAC tickets", () => {
    const packed = signTicket(ticket, "k");
    const got = verifyTicket(packed, "k", 1_500);
    expect(got.sha256).toBe("abc");
  });

  it("rejects the wrong key and expired tickets", () => {
    const packed = signTicket(ticket, "k");
    expect(() => verifyTicket(packed, "other", 1_500)).toThrow(/signature/);
    expect(() => verifyTicket(packed, "k", 3_000)).toThrow(/expired/);
  });

  it("computes stable device HMAC", () => {
    const a = hmacDevice("secret", "1", "POST", "/api/agent/evaluate", "deadbeef");
    const b = hmacDevice("secret", "1", "post", "/api/agent/evaluate", "deadbeef");
    expect(a).toBe(b);
  });
});
