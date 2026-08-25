import { NextResponse } from "next/server";
import { getDb, listJit, createJit, appendAudit, getDevice, grantIdentities } from "@/lib/db";
import { isResponse, requireAdmin } from "@/lib/http";
import { signTicket } from "@/lib/signing";
import { ticketKeyForDevice } from "@/lib/evaluate";
import { queueNotification } from "@/lib/notify";
import { notifyJitGrant } from "@/lib/realtime/notify";
import { expireDueJit } from "@/lib/jit-expiry";

export async function GET() {
  const auth = await requireAdmin("jit.view");
  if (isResponse(auth)) return auth;
  expireDueJit();
  return NextResponse.json(listJit(getDb()));
}

export async function POST(req: Request) {
  const auth = await requireAdmin("jit.grant");
  if (isResponse(auth)) return auth;
  const body = (await req.json()) as {
    userId?: string;
    groupId?: string;
    deviceId?: string;
    durationMinutes?: number;
    reason?: string;
  };
  const hasUser = Boolean(body.userId?.trim());
  const hasGroup = Boolean(body.groupId?.trim());
  if (hasUser === hasGroup) {
    return NextResponse.json({ error: "provide exactly one of userId or groupId" }, { status: 400 });
  }
  const db = getDb();
  expireDueJit();
  const grant = createJit(db, {
    userId: body.userId || "",
    groupId: body.groupId || "",
    deviceId: body.deviceId || "",
    durationMinutes: Number(body.durationMinutes),
    reason: body.reason || "",
  });
  if ("error" in grant) return NextResponse.json(grant, { status: 400 });
  const device = getDevice(db, grant.deviceId);
  const now = Math.floor(Date.now() / 1000);
  const key = ticketKeyForDevice(grant.deviceId);
  // One signed ticket per covered identity: the grant user, or each group
  // member in the snapshot taken at grant time.
  const identities = grantIdentities(db, grant);
  const tickets = identities.map((identity) => ({
    userSid: identity.userSid,
    displayName: identity.displayName,
    ticket: signTicket(
      {
        typ: "jit",
        sub: identity.userSid,
        dev: grant.deviceId,
        sha256: "",
        publisher: "",
        path: "*",
        child: "allow",
        nbf: now - 5,
        exp: Math.floor(new Date(grant.expiresAt).getTime() / 1000),
        // Unique per identity and schtask-safe (no colons): the agent embeds
        // this in its local `PrivGate-JIT-<nonce>` revoke task name.
        nonce: `${grant.id}-${identity.userId}`,
      },
      key,
    ),
  }));
  const primary = tickets[0];
  if (!primary) return NextResponse.json({ error: "grant covers no resolvable directory identity" }, { status: 400 });
  const whoLabel = grant.groupId
    ? `group ${grant.groupId} (${identities.length} member${identities.length === 1 ? "" : "s"} at grant time)`
    : identities[0]?.displayName || grant.userId;
  appendAudit(db, auth.session.email, "jit.grant", grant.id, {
    ...(grant.groupId ? { group: grant.groupId, members: identities.length } : { user: identities[0]?.displayName }),
    host: device?.hostname,
    minutes: grant.durationMinutes,
    reason: grant.reason,
  });
  notifyJitGrant(grant, tickets);
  queueNotification(db, {
    kind: "jit",
    riskLevel: "high",
    title: `[PrivGate] JIT admin window opened on ${device?.hostname || grant.deviceId}`,
    body: [
      grant.groupId ? `Group: ${whoLabel}` : `User: ${whoLabel}`,
      `Device: ${device?.hostname || grant.deviceId}`,
      `Duration: ${grant.durationMinutes} minutes`,
      `Reason: ${grant.reason}`,
    ].join("\n"),
  });
  return NextResponse.json(
    {
      ...grant,
      ticket: primary.ticket,
      identities: tickets,
      localRevoke: {
        scheduledTaskName: `PrivGate-JIT-${grant.id}`,
        expiresAt: grant.expiresAt,
        userSids: tickets.map((t) => t.userSid),
        instruction:
          "Broker must register a local scheduled task at grant time that removes every covered SID from Administrators even if the API is unreachable.",
      },
    },
    { status: 201 },
  );
}
