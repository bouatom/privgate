import { NextResponse } from "next/server";
import { getDb, appendAudit } from "@/lib/db";
import { evaluateForDevice } from "@/lib/evaluate";
import { verifyDeviceRequest } from "@/lib/device-auth";
import { checkDeviceRateLimit } from "@/lib/rate-limit";

// Rate limit: 30 requests per 60 seconds = ~1 req/sec sustained
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX_REQUESTS = 30;

export async function POST(req: Request) {
  const raw = await req.text();
  const auth = verifyDeviceRequest({
    deviceId: req.headers.get("x-device-id"),
    timestamp: req.headers.get("x-timestamp"),
    signature: req.headers.get("x-signature"),
    method: "POST",
    path: "/api/agent/evaluate",
    rawBody: raw,
  });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Check rate limit AFTER device auth succeeds
  const db = getDb();
  const rateLimitResult = checkDeviceRateLimit(auth.deviceId, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS);
  if (!rateLimitResult.ok) {
    const retryAfterSec = Math.ceil(rateLimitResult.retryAfter / 1000);
    appendAudit(db, `device:${auth.deviceId}`, "agent.rate-limit", auth.deviceId, {
      retryAfterSec,
    });
    return NextResponse.json(
      {
        error: "rate limit exceeded, retry after",
        retryAfter: retryAfterSec,
      },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSec) },
      },
    );
  }

  let body: { userSid?: string; entraOid?: string; filePath?: string; fileHash?: string; publisher?: string; arguments?: string };
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!body.userSid || !body.filePath || !body.fileHash || !body.publisher) {
    return NextResponse.json({ error: "userSid, filePath, fileHash, publisher required" }, { status: 400 });
  }
  const result = evaluateForDevice(db, auth.deviceId, {
    userSid: body.userSid,
    entraOid: body.entraOid,
    filePath: body.filePath,
    fileHash: body.fileHash,
    publisher: body.publisher,
    arguments: body.arguments,
  });
  return NextResponse.json(result);
}
