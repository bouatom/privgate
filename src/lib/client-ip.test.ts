import { describe, expect, it } from "vitest";
import { resolveClientIp } from "./client-ip";

const SOCKET_REMOTE = "10.0.0.5";

describe("resolveClientIp", () => {
  it("uses the socket remote address when the proxy is not trusted (ignores XFF)", () => {
    expect(
      resolveClientIp({ remoteAddress: SOCKET_REMOTE, forwardedFor: "203.0.113.9" }, {}),
    ).toBe(SOCKET_REMOTE);
  });

  it("honours X-Forwarded-For only when PRIVGATE_TRUST_PROXY=1", () => {
    expect(
      resolveClientIp(
        { remoteAddress: SOCKET_REMOTE, forwardedFor: "203.0.113.9" },
        { PRIVGATE_TRUST_PROXY: "1" },
      ),
    ).toBe("203.0.113.9");
  });

  it("takes the leftmost entry of a comma-separated X-Forwarded-For chain", () => {
    expect(
      resolveClientIp(
        { remoteAddress: SOCKET_REMOTE, forwardedFor: "203.0.113.9, 10.0.0.1" },
        { PRIVGATE_TRUST_PROXY: "1" },
      ),
    ).toBe("203.0.113.9");
  });

  it("falls back to the socket address when a trusted proxy sends an empty XFF", () => {
    expect(
      resolveClientIp({ remoteAddress: SOCKET_REMOTE, forwardedFor: "" }, { PRIVGATE_TRUST_PROXY: "1" }),
    ).toBe(SOCKET_REMOTE);
  });

  it("strips the IPv4-mapped IPv6 prefix", () => {
    expect(resolveClientIp({ remoteAddress: "::ffff:10.0.0.5" }, {})).toBe("10.0.0.5");
  });

  it("returns '' when there is no remote address and the proxy is not trusted", () => {
    expect(resolveClientIp({ forwardedFor: "203.0.113.9" }, {})).toBe("");
  });

  it("treats 'unknown' as unusable", () => {
    expect(resolveClientIp({ remoteAddress: "unknown" }, {})).toBe("");
  });
});
