import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { evaluateForDevice } from "@/lib/evaluate";
import { verifyDeviceRequest } from "@/lib/device-auth";

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
  const body = JSON.parse(raw || "{}") as {
    userSid?: string;
    entraOid?: string;
    filePath?: string;
    fileHash?: string;
    publisher?: string;
    arguments?: string;
  };
  if (!body.userSid || !body.filePath || !body.fileHash || !body.publisher) {
    return NextResponse.json({ error: "userSid, filePath, fileHash, publisher required" }, { status: 400 });
  }
  const result = evaluateForDevice(getDb(), auth.deviceId, {
    userSid: body.userSid,
    entraOid: body.entraOid,
    filePath: body.filePath,
    fileHash: body.fileHash,
    publisher: body.publisher,
    arguments: body.arguments,
  });
  return NextResponse.json(result);
}
