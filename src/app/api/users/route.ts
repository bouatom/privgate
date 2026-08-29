import { NextResponse } from "next/server";
import { getDb, listUsers, upsertUsers, appendAudit } from "@/lib/db";
import { isResponse, requireAdmin } from "@/lib/http";
import { presentUsers } from "@/lib/present";

export async function GET() {
  const auth = await requireAdmin("directory.users.view");
  if (isResponse(auth)) return auth;
  return NextResponse.json(presentUsers(listUsers(getDb())));
}

export async function POST(req: Request) {
  const auth = await requireAdmin("directory.users.manage");
  if (isResponse(auth)) return auth;
  const body = (await req.json()) as {
    users?: Array<{
      displayName: string;
      userPrincipalName: string;
      adSid?: string;
      entraOid?: string;
      roles?: string[];
    }>;
  };
  if (!body.users?.length) return NextResponse.json({ error: "users required" }, { status: 400 });
  const db = getDb();
  upsertUsers(db, body.users);
  appendAudit(db, auth.session.email, "directory.sync", "users", { count: body.users.length });
  return NextResponse.json({ upserted: body.users.length });
}
