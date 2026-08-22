import { NextResponse } from "next/server";
import { getDb, listJit, createJit, appendAudit, getUser, getDevice } from "@/lib/db";
import { isResponse, requireAdmin } from "@/lib/http";
import { signTicket } from "@/lib/signing";
import { ticketKey } from "@/lib/evaluate";
import { queueNotification } from "@/lib/notify";

export async function GET() {
  const auth = await requireAdmin("Approver");
  if (isResponse(auth)) return auth;
  return NextResponse.json(listJit(getDb()));
}

export async function POST(req: Request) {
  const auth = await requireAdmin("Approver");
  if (isResponse(auth)) return auth;
  const body = (await req.json()) as {
    userId?: string;
    deviceId?: string;
    durationMinutes?: number;
    reason?: string;
  };
  const db = getDb();
  const grant = createJit(db, {
    userId: body.userId || "",
    deviceId: body.deviceId || "",
    durationMinutes: Number(body.durationMinutes),
    reason: body.reason || "",
  });
  if ("error" in grant) return NextResponse.json(grant, { status: 400 });
  const user = getUser(db, grant.userId);
  const device = getDevice(db, grant.deviceId);
  const now = Math.floor(Date.now() / 1000);
  const ticket = signTicket(
    {
      typ: "jit",
      sub: user?.adSid || user?.entraOid || grant.userId,
      dev: grant.deviceId,
      sha256: "",
      publisher: "",
      path: "*",
      child: "allow",
      nbf: now - 5,
      exp: Math.floor(new Date(grant.expiresAt).getTime() / 1000),
      nonce: grant.id,
    },
    ticketKey(),
  );
  appendAudit(db, auth.session.email, "jit.grant", grant.id, {
    user: user?.userPrincipalName,
    host: device?.hostname,
    minutes: grant.durationMinutes,
    reason: grant.reason,
  });
  queueNotification(db, {
    kind: "jit",
    riskLevel: "high",
    title: `[PrivGate] JIT admin window opened on ${device?.hostname || grant.deviceId}`,
    body: [
      `User: ${user?.userPrincipalName || grant.userId}`,
      `Device: ${device?.hostname || grant.deviceId}`,
      `Duration: ${grant.durationMinutes} minutes`,
      `Reason: ${grant.reason}`,
    ].join("\n"),
  });
  return NextResponse.json(
    {
      ...grant,
      ticket,
      localRevoke: {
        scheduledTaskName: `PrivGate-JIT-${grant.id}`,
        expiresAt: grant.expiresAt,
        userSid: user?.adSid,
        instruction: "Broker must register a local scheduled task at grant time that removes the user from Administrators even if the API is unreachable.",
      },
    },
    { status: 201 },
  );
}
