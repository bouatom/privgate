import { NextResponse } from "next/server";
import { getDb, listGroups } from "@/lib/db";
import { isResponse, requireAdmin } from "@/lib/http";

export async function GET() {
  const auth = await requireAdmin();
  if (isResponse(auth)) return auth;
  return NextResponse.json(listGroups(getDb()));
}
