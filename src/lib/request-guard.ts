/**
 * Request body size guard for App Router route handlers.
 *
 * A hostile client must not be able to POST an unbounded JSON body into an open
 * (pre-auth) route and force the server to buffer it in memory. This module
 * offers two complementary, framework-light helpers that work on the standard
 * web `Request` (no `next/server` dependency), so they are trivial to unit test:
 *
 *  1. `bodyTooLarge()` — a cheap pre-check against the `Content-Length` header.
 *     Call it first in a handler and short-circuit with 413 before reading the
 *     body. This catches the overwhelming majority of hostile clients.
 *
 *  2. `readBodyWithLimit()` / `readJsonWithLimit()` — a robust capped read that
 *     stops as soon as the actual stream exceeds the cap. Use these INSTEAD of
 *     bare `req.json()`/`req.text()` on open routes, because they also catch a
 *     client that uses chunked transfer encoding with no Content-Length header.
 *
 * The default cap is 256 KB, which comfortably fits every JSON payload this
 * console accepts (small config/decision bodies). The audit CSV export is a GET
 * with query-string filters, so it is unaffected. The cap is operator-tunable
 * via `PRIVGATE_MAX_BODY_BYTES`.
 */
/** Default maximum request body size in bytes (256 KB). */
export const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

/** Resolve the effective cap from env; falls back to the default when unset/invalid. */
export function maxBodyBytes(env: Record<string, string | undefined> = process.env): number {
  const n = Number.parseInt((env.PRIVGATE_MAX_BODY_BYTES || "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_BODY_BYTES;
}

/**
 * True when the declared `Content-Length` already exceeds the cap. This is a
 * cheap first-line pre-check only: it does NOT consume the request body, so it
 * is safe to call before `req.json()`, `req.text()`, or HMAC verification.
 *
 * A malformed/negative length is treated as too large (fail-closed). When the
 * header is ABSENT (e.g. chunked transfer encoding) this returns `false` and
 * enforcement is delegated to the bounded streaming readers in this module
 * (`readBodyWithLimit`/`readJsonWithLimit`), which stop buffering the instant
 * the real body exceeds the cap. Relying on a header pre-check alone would
 * either reject legitimate bodyless requests or trust an unbounded stream; the
 * streaming path covers both correctly.
 */
export function bodyTooLarge(req: Request, maxBytes = DEFAULT_MAX_BODY_BYTES): boolean {
  const raw = req.headers.get("content-length");
  if (!raw) return false; // no length declared → enforce via the streaming capped read
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return true; // malformed length → fail closed
  return n > maxBytes;
}

export type BodyReadResult = { ok: true; text: string } | { ok: false; reason: "too_large" | "read_failed" };

/**
 * Read the body as text, stopping the instant the byte count exceeds the cap.
 * This bounds memory even for chunked/no-Content-Length clients. Decodes via a
 * streaming TextDecoder so multi-byte UTF-8 characters split across chunks are
 * preserved. On oversize we cancel the underlying stream and return without
 * buffering the tail.
 */
export async function readBodyWithLimit(
  req: Request,
  maxBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<BodyReadResult> {
  if (!req.body) return { ok: false, reason: "read_failed" };
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          return { ok: false, reason: "too_large" };
        }
        text += decoder.decode(value, { stream: true });
      }
    }
    text += decoder.decode(); // flush any trailing partial sequence
    return { ok: true, text };
  } catch {
    return { ok: false, reason: "read_failed" };
  }
}

export type JsonReadResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; reason: "too_large" | "read_failed" | "json" };

/** Capped body read followed by JSON.parse. The safe drop-in for `await req.json()`. */
export async function readJsonWithLimit<T = unknown>(
  req: Request,
  maxBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<JsonReadResult<T>> {
  const read = await readBodyWithLimit(req, maxBytes);
  if (!read.ok) return read;
  try {
    return { ok: true, value: JSON.parse(read.text) as T };
  } catch {
    return { ok: false, reason: "json" };
  }
}
