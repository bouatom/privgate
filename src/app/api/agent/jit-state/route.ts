import { NextResponse } from "next/server";
import { getDb, findUserBySid, activeJit, revokeJit } from "@/lib/db";
import { verifyDeviceRequest } from "@/lib/device-auth";

export async function GET(req: Request) {
  const auth = verifyDeviceRequest({
    deviceId: req.headers.get("x-device-id"),
    timestamp: req.headers.get("x-timestamp"),
    signature: req.headers.get("x-signature"),
    method: "GET",
    path: "/api/agent/jit-state",
    rawBody: "",
  });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userSid = new URL(req.url).searchParams.get("userSid") || "";
  const user = findUserBySid(getDb(), userSid);
  if (!user) return NextResponse.json({ active: false });
  const grant = activeJit(getDb(), user.id, auth.deviceId);
  return NextResponse.json({
    active: Boolean(grant),
    grant: grant ?? null,
    userSid: user.adSid,
  });
}

export async function POST(req: Request) {
  const raw = await req.text();
  const auth = verifyDeviceRequest({
    deviceId: req.headers.get("x-device-id"),
    timestamp: req.headers.get("x-timestamp"),
    signature: req.headers.get("x-signature"),
    method: "POST",
    path: "/api/agent/jit-state",
    rawBody: raw,
  });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = JSON.parse(raw || "{}") as { grantId?: string; event?: string };
  if (body.event === "expired" && body.grantId) {
    revokeJit(getDb(), body.grantId, `device:${auth.deviceId}`);
  }
  return NextResponse.json({ ok: true });
}
