import { NextResponse } from "next/server";
import { getDb, registerOrReuseDevice, appendAudit } from "@/lib/db";
import { verifyEnrollmentToken, normalizeHostname, normalizeJoinType } from "@/lib/enrollment";
import { ticketKeyForDevice } from "@/lib/evaluate";
import { deviceSecretKey } from "@/lib/secrets";
import { notifyDeviceChange } from "@/lib/realtime/notify";

export async function POST(req: Request) {
  if (!verifyEnrollmentToken(req.headers.get("x-enrollment-token"))) {
    return NextResponse.json({ error: "invalid enrollment token" }, { status: 401 });
  }
  let body: { hostname?: string; joinType?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const hostname = normalizeHostname(body.hostname || "");
  if (!hostname) return NextResponse.json({ error: "hostname required" }, { status: 400 });
  const joinType = normalizeJoinType(body.joinType);
  const db = getDb();
  const registered = registerOrReuseDevice(db, hostname, joinType, deviceSecretKey());
  appendAudit(db, `device:${registered.id}`, registered.reused ? "device.reconnect" : "device.enroll", registered.id, {
    hostname: registered.hostname,
    joinType,
  });
  notifyDeviceChange();
  return NextResponse.json({
    deviceId: registered.id,
    deviceSecret: registered.secret,
    ticketSigningKey: ticketKeyForDevice(registered.id),
    hostname: registered.hostname,
  });
}
