import { NextResponse } from "next/server";
import { getDb, listAudit } from "@/lib/db";
import { isResponse, requireAdmin } from "@/lib/http";
import { presentAudit } from "@/lib/present";

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (isResponse(auth)) return auth;
  const q = new URL(req.url).searchParams.get("q") || undefined;
  return NextResponse.json(presentAudit(listAudit(getDb(), q)));
}
