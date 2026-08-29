import { NextResponse } from "next/server";
import { verifyDeviceRequest } from "@/lib/device-auth";
import { describeClientUpdate } from "@/lib/agent-update";

const CHECK_PATH = "/api/agent/update/check";

export async function GET(req: Request) {
  const auth = verifyDeviceRequest({
    deviceId: req.headers.get("x-device-id"),
    timestamp: req.headers.get("x-timestamp"),
    signature: req.headers.get("x-signature"),
    method: "GET",
    path: CHECK_PATH,
    rawBody: "",
  });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const installed = new URL(req.url).searchParams.get("installed") || "";
  return NextResponse.json(describeClientUpdate(installed));
}
