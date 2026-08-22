import { NextResponse } from "next/server";
import { getDb, listRequests } from "@/lib/db";
import { isResponse, requireAdmin } from "@/lib/http";

export async function GET() {
  const auth = await requireAdmin("Approver");
  if (isResponse(auth)) return auth;
  return NextResponse.json(listRequests(getDb()));
}
