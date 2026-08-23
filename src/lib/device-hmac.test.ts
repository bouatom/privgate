import { describe, expect, it } from "vitest";
import { hmacDevice } from "./signing";
import { bodySha256 } from "./evaluate";

describe("device HMAC contract", () => {
  it("matches the Windows agent string format", () => {
    const body = '{"userSid":"S-1-5-21-1"}';
    const sig = hmacDevice(
      "lab-device-secret-do-not-use-in-prod",
      "1710000000000",
      "POST",
      "/api/agent/evaluate",
      bodySha256(body),
    );
    expect(sig.length).toBeGreaterThan(20);
    expect(sig).not.toContain("+");
    expect(sig).not.toContain("/");
  });

  it("signs the realtime WebSocket upgrade the same way", () => {
    const sig = hmacDevice(
      "lab-device-secret-do-not-use-in-prod",
      "1710000000000",
      "GET",
      "/api/agent/ws",
      bodySha256(""),
    );
    expect(sig.length).toBeGreaterThan(20);
  });
});
