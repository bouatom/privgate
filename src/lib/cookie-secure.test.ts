import { describe, expect, it } from "vitest";
import { cookieSecure } from "./cookie-secure";

function req(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

describe("cookieSecure", () => {
  it("is false for HTTP even when NODE_ENV is production", () => {
    expect(cookieSecure(req("http://10.0.2.25:3000/api/auth/login"), { NODE_ENV: "production" })).toBe(
      false,
    );
  });

  it("is true for HTTPS", () => {
    expect(cookieSecure(req("https://console.contoso.test/api/auth/login"), {})).toBe(true);
  });

  it("follows PRIVGATE_PUBLIC_ORIGIN when set to https", () => {
    expect(
      cookieSecure(req("http://127.0.0.1:3000/api/auth/login"), {
        PRIVGATE_PUBLIC_ORIGIN: "https://console.contoso.test",
      }),
    ).toBe(true);
  });

  it("stays false when PRIVGATE_PUBLIC_ORIGIN is http", () => {
    expect(
      cookieSecure(req("https://ignored.test/api/auth/login"), {
        PRIVGATE_PUBLIC_ORIGIN: "http://10.0.2.25:3000",
      }),
    ).toBe(false);
  });

  it("honours an explicit override", () => {
    expect(cookieSecure(req("http://10.0.2.25:3000/"), { PRIVGATE_COOKIE_SECURE: "1" })).toBe(true);
    expect(cookieSecure(req("https://console.test/"), { PRIVGATE_COOKIE_SECURE: "0" })).toBe(false);
  });

  it("trusts X-Forwarded-Proto only when the proxy is trusted", () => {
    const headers = { "x-forwarded-proto": "https" };
    expect(cookieSecure(req("http://127.0.0.1:3000/", headers), {})).toBe(false);
    expect(
      cookieSecure(req("http://127.0.0.1:3000/", headers), { PRIVGATE_TRUST_PROXY: "1" }),
    ).toBe(true);
  });
});
