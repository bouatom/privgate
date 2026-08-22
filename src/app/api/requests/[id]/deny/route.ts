import { NextResponse } from "next/server";
import { getDb, decideRequest, appendAudit } from "@/lib/db";
import { isResponse, requireAdmin } from "@/lib/http";
import { queueNotification, requestNotifyEvent } from "@/lib/notify";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin("requests.deny");
  if (isResponse(auth)) return auth;
  const { id } = await ctx.params;
  const db = getDb();
  const decided = decideRequest(db, id, "denied", auth.session.email);
  if (!decided) return NextResponse.json({ error: "not pending" }, { status: 409 });
  appendAudit(db, auth.session.email, "request.deny", id, { file: decided.filePath });
  queueNotification(
    db,
    requestNotifyEvent("denied", { filePath: decided.filePath, riskLevel: decided.riskLevel, userId: decided.userId, deviceId: decided.deviceId }, db),
  );
  return new NextResponse(null, { status: 204 });
}
