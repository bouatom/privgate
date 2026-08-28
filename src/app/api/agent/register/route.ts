import { NextResponse } from "next/server";
import { getDb, registerOrReuseDevice, appendAudit, setDeviceLastIp } from "@/lib/db";
import { verifyEnrollmentToken, normalizeHostname, normalizeJoinType } from "@/lib/enrollment";
import { ticketKeyForDevice } from "@/lib/evaluate";
import { deviceSecretKey } from "@/lib/secrets";
import { notifyDeviceChange } from "@/lib/realtime/notify";
import { resolveClientIp } from "@/lib/client-ip";
import { bodyTooLarge, maxBodyBytes, readJsonWithLimit } from "@/lib/request-guard";

export async function POST(req: Request) {
  const maxBytes = maxBodyBytes();
  if (bodyTooLarge(req, maxBytes)) {
    return NextResponse.json({ error: "request body too large" }, { status: 413 });
  }
  if (!verifyEnrollmentToken(req.headers.get("x-enrollment-token"))) {
    return NextResponse.json({ error: "invalid enrollment token" }, { status: 401 });
  }
  const read = await readJsonWithLimit<{ hostname?: string; joinType?: string }>(req, maxBytes);
  if (!read.ok) {
    return NextResponse.json(
      { error: read.reason === "too_large" ? "request body too large" : "invalid json" },
      { status: read.reason === "too_large" ? 413 : 400 },
    );
  }
  const body = read.value;
  const hostname = normalizeHostname(body.hostname || "");
  if (!hostname) return NextResponse.json({ error: "hostname required" }, { status: 400 });
  const joinType = normalizeJoinType(body.joinType);
  const db = getDb();
  const registered = registerOrReuseDevice(db, hostname, joinType, deviceSecretKey());
  // Stamp the source IP seen at enrollment (honors PRIVGATE_TRUST_PROXY for
  // X-Forwarded-For). The requested Request has no raw socket address, so this
  // only populates when the proxy is trusted; the persistent WS handshake in
  // agent-hub.ts fills the field in the common case.
  setDeviceLastIp(
    db,
    registered.id,
    resolveClientIp({ forwardedFor: req.headers.get("x-forwarded-for") }),
  );
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
