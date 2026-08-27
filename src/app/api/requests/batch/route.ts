import { NextResponse } from "next/server";
import { getDb, decideRequest, appendAudit } from "@/lib/db";
import { approvedTicket } from "@/lib/evaluate";
import { isResponse, requireAdmin } from "@/lib/http";
import { queueNotification, requestNotifyEvent } from "@/lib/notify";
import { notifyRequestApproved, notifyRequestDenied } from "@/lib/realtime/notify";

export async function POST(req: Request) {
  const auth = await requireAdmin(["requests.approve", "requests.deny"]);
  if (isResponse(auth)) return auth;
  let body: { ids?: string[]; action?: string };
  try {
    body = (await req.json()) as { ids?: string[]; action?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
  const action = body.action;
  if (!ids.length || (action !== "approve" && action !== "deny")) {
    return NextResponse.json({ error: "ids (non-empty array) and action (approve|deny) required" }, { status: 400 });
  }
  const db = getDb();
  const status = action === "approve" ? "approved" : "denied";
  let decided = 0;
  let alreadyDecided = 0;
  for (const id of ids) {
    const result = decideRequest(db, id, status, auth.session.email);
    if (result) {
      decided++;
      appendAudit(db, auth.session.email, `request.${status}`, id, { file: result.filePath, batch: true });
      if (action === "approve") {
        const ticket = approvedTicket(db, id);
        if (ticket) notifyRequestApproved(result, ticket);
      } else {
        notifyRequestDenied(result);
      }
      queueNotification(
        db,
        requestNotifyEvent(status, { filePath: result.filePath, riskLevel: result.riskLevel, userId: result.userId, deviceId: result.deviceId }, db),
      );
    } else {
      alreadyDecided++;
    }
  }
  return NextResponse.json({ decided, alreadyDecided });
}
