import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_BODY_BYTES,
  bodyTooLarge,
  maxBodyBytes,
  readBodyWithLimit,
  readJsonWithLimit,
} from "./request-guard";

function postWith(contentLength: string | null, body?: BodyInit): Request {
  const headers: Record<string, string> = {};
  if (contentLength !== null) headers["content-length"] = contentLength;
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers,
    body: body ?? undefined,
  });
}

function streamRequest(chunks: Uint8Array[]): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
  // `duplex: "half"` is required to send a streaming body but is not in this
  // TS lib's RequestInit yet, so cast past it (valid at runtime in Node 18+).
  const init = { method: "POST", body: stream, duplex: "half" } as unknown as RequestInit;
  return new Request("http://localhost/api/test", init);
}

describe("maxBodyBytes", () => {
  it("defaults to 256 KB when env is unset or invalid", () => {
    expect(maxBodyBytes({})).toBe(DEFAULT_MAX_BODY_BYTES);
    expect(maxBodyBytes({ PRIVGATE_MAX_BODY_BYTES: "abc" })).toBe(DEFAULT_MAX_BODY_BYTES);
    expect(maxBodyBytes({ PRIVGATE_MAX_BODY_BYTES: "0" })).toBe(DEFAULT_MAX_BODY_BYTES);
  });

  it("honors a configured positive cap", () => {
    expect(maxBodyBytes({ PRIVGATE_MAX_BODY_BYTES: "131072" })).toBe(131072);
  });
});

describe("bodyTooLarge", () => {
  it("accepts a body at or under the cap", () => {
    expect(bodyTooLarge(postWith(String(256 * 1024)))).toBe(false);
    expect(bodyTooLarge(postWith("128"))).toBe(false);
  });

  it("rejects a body over the cap", () => {
    expect(bodyTooLarge(postWith(String(256 * 1024 + 1)))).toBe(true);
    expect(bodyTooLarge(postWith("999999"))).toBe(true);
  });

  it("rejects a malformed or negative Content-Length (fail-closed)", () => {
    expect(bodyTooLarge(postWith("not-a-number"))).toBe(true);
    expect(bodyTooLarge(postWith("-1"))).toBe(true);
  });

  it("does not reject on an absent header (enforcement delegates to the streaming read)", () => {
    expect(bodyTooLarge(postWith(null))).toBe(false);
  });

  it("respects a custom cap", () => {
    expect(bodyTooLarge(postWith("100"), 64)).toBe(true);
    expect(bodyTooLarge(postWith("10"), 64)).toBe(false);
  });
});

describe("readBodyWithLimit", () => {
  it("returns the body text when under the cap", async () => {
    const res = await readBodyWithLimit(postWith(null, '{"a":1}'), 256);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.text).toBe('{"a":1}');
  });

  it("rejects as too_large once the stream exceeds the cap (chunked/no Content-Length)", async () => {
    const big = new Uint8Array(64).fill(0x61); // 64 x 'a'
    const res = await readBodyWithLimit(streamRequest([big]), 32);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("too_large");
  });

  it("preserves multi-byte UTF-8 characters split across chunk boundaries", async () => {
    const snowman = Buffer.from("❄"); // 3-byte UTF-8 sequence
    const a = snowman.subarray(0, 1);
    const b = snowman.subarray(1);
    const res = await readBodyWithLimit(streamRequest([a, b]), 64);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.text).toBe("❄");
  });

  it("returns read_failed for a request without a body stream", async () => {
    // A GET with no body has req.body === null.
    const res = await readBodyWithLimit(new Request("http://localhost/api/x", { method: "GET" }), 64);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("read_failed");
  });
});

describe("readJsonWithLimit", () => {
  it("parses valid JSON under the cap", async () => {
    const res = await readJsonWithLimit<{ email: string }>(postWith(null, '{"email":"a@b.c"}'), 256);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.email).toBe("a@b.c");
  });

  it("rejects as too_large when over the cap", async () => {
    const big = new Uint8Array(64).fill(0x61);
    const res = await readJsonWithLimit(streamRequest([big]), 32);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("too_large");
  });

  it("returns reason 'json' for malformed JSON under the cap", async () => {
    const res = await readJsonWithLimit(postWith(null, "not-json"), 256);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("json");
  });
});
