import { describe, expect, it } from "vitest";
import { requestOrigin } from "./origin";

function req(headers: Record<string, string> = {}, url = "http://127.0.0.1:3000/api/x") {
  return new Request(url, { headers });
}

describe("requestOrigin", () => {
  it("uses the request URL when nothing is configured", () => {
    expect(requestOrigin(req(), {})).toBe("http://127.0.0.1:3000");
  });

  it("ignores an attacker-supplied Host header", () => {
    expect(requestOrigin(req({ host: "evil.example" }), {})).toBe("http://127.0.0.1:3000");
  });

  it("ignores X-Forwarded-Host even when the host is allowlisted", () => {
    const env = { PRIVGATE_TRUSTED_HOSTS: "console.contoso.test,evil.example" };
    expect(requestOrigin(req({ "x-forwarded-host": "evil.example" }), env)).toBe("http://127.0.0.1:3000");
  });

  it("ignores X-Forwarded-Proto unless the proxy is trusted", () => {
    expect(requestOrigin(req({ "x-forwarded-proto": "https" }), {})).toBe("http://127.0.0.1:3000");
  });

  it("prefers the explicitly configured public origin", () => {
    const env = { PRIVGATE_PUBLIC_ORIGIN: "https://console.contoso.test" };
    expect(requestOrigin(req({ host: "evil.example" }), env)).toBe("https://console.contoso.test");
  });

  it("falls back to the request URL when the configured origin is malformed", () => {
    expect(requestOrigin(req(), { PRIVGATE_PUBLIC_ORIGIN: "not a url" })).toBe("http://127.0.0.1:3000");
  });

  it("accepts an allowlisted Host header", () => {
    const env = { PRIVGATE_TRUSTED_HOSTS: "console.contoso.test" };
    expect(requestOrigin(req({ host: "console.contoso.test" }), env)).toBe("http://console.contoso.test");
  });

  it("rejects a Host header that is not allowlisted", () => {
    const env = { PRIVGATE_TRUSTED_HOSTS: "console.contoso.test" };
    expect(requestOrigin(req({ host: "evil.example" }), env)).toBe("http://127.0.0.1:3000");
  });

  it("honours forwarded headers only when the proxy is trusted and the host allowlisted", () => {
    const env = { PRIVGATE_TRUST_PROXY: "1", PRIVGATE_TRUSTED_HOSTS: "console.contoso.test" };
    const origin = requestOrigin(
      req({ "x-forwarded-host": "console.contoso.test", "x-forwarded-proto": "https" }),
      env,
    );
    expect(origin).toBe("https://console.contoso.test");
  });

  it("still rejects a forwarded host outside the allowlist on a trusted proxy", () => {
    const env = { PRIVGATE_TRUST_PROXY: "1", PRIVGATE_TRUSTED_HOSTS: "console.contoso.test" };
    expect(requestOrigin(req({ "x-forwarded-host": "evil.example" }), env)).toBe("http://127.0.0.1:3000");
  });
});
