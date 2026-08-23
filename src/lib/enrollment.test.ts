import { describe, expect, it } from "vitest";
import { enrollmentToken, normalizeHostname, normalizeJoinType, verifyEnrollmentToken } from "./enrollment";

describe("client enrollment", () => {
  it("accepts the token derived for this console", () => {
    const token = enrollmentToken({
      NODE_ENV: "development",
      DEVICE_SECRET_KEY: "dev-device-secret-key-32bytes!!",
    });
    expect(token.length).toBeGreaterThan(20);
    expect(
      verifyEnrollmentToken(token, {
        NODE_ENV: "development",
        DEVICE_SECRET_KEY: "dev-device-secret-key-32bytes!!",
      }),
    ).toBe(true);
    expect(
      verifyEnrollmentToken("nope", {
        NODE_ENV: "development",
        DEVICE_SECRET_KEY: "dev-device-secret-key-32bytes!!",
      }),
    ).toBe(false);
  });

  it("normalizes hostnames and ignores join type from the admin console", () => {
    expect(normalizeHostname("LAB-W11-01")).toBe("LAB-W11-01");
    expect(normalizeHostname("bad host")).toBeNull();
    expect(normalizeJoinType("hybrid")).toBe("hybrid");
    expect(normalizeJoinType("something-else")).toBe("unknown");
  });
});
