import { NextResponse } from "next/server";
import { getDb, appendAudit } from "@/lib/db";
import { verifyDeviceRequest } from "@/lib/device-auth";
import { checkDeviceRateLimit } from "@/lib/rate-limit";
import { getJitStateForDevice } from "@/lib/evaluate";

// Rate limit: 60 requests per 60 seconds = 1 req/sec (idempotent, stricter)
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX_REQUESTS = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const auth = verifyDeviceRequest({
    deviceId: req.headers.get("x-device-id"),
    timestamp: req.headers.get("x-timestamp"),
    signature: req.headers.get("x-signature"),
    method: "GET",
    path: "/api/agent/jit-state",
    rawBody: "",
  });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Check rate limit AFTER device auth succeeds
  const db = getDb();
  const rateLimitResult = checkDeviceRateLimit(auth.deviceId, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS);
  if (!rateLimitResult.ok) {
    const retryAfterSec = Math.ceil(rateLimitResult.retryAfter / 1000);
    appendAudit(db, `device:${auth.deviceId}`, "agent.rate-limit.jit-state", auth.deviceId, {
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

  const userSid = url.searchParams.get("userSid");
  if (!userSid) {
    return NextResponse.json({ error: "userSid query parameter required" }, { status: 400 });
  }

  return NextResponse.json(getJitStateForDevice(db, auth.deviceId, userSid));
}
