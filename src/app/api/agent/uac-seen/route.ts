import { NextResponse } from "next/server";
import { verifyDeviceRequest } from "@/lib/device-auth";
import { bodyTooLarge, maxBodyBytes } from "@/lib/request-guard";
import { handleUacSeen } from "@/lib/uac-prompt";

export async function POST(req: Request) {
  if (bodyTooLarge(req, maxBodyBytes())) {
    return NextResponse.json({ error: "request body too large" }, { status: 413 });
  }
  const raw = await req.text();
  const auth = verifyDeviceRequest({
    deviceId: req.headers.get("x-device-id"),
    timestamp: req.headers.get("x-timestamp"),
    signature: req.headers.get("x-signature"),
    method: "POST",
    path: "/api/agent/uac-seen",
    rawBody: raw,
  });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { userSid?: string; filePath?: string; fileHash?: string; publisher?: string; arguments?: string };
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const result = handleUacSeen(auth.deviceId, {
    userSid: body.userSid || "",
    filePath: body.filePath,
    fileHash: body.fileHash,
    publisher: body.publisher,
    arguments: body.arguments,
  });
  return NextResponse.json(result);
}
