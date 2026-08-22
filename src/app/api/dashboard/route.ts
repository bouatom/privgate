import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isResponse, requireAdmin } from "@/lib/http";
import { dashboardPayload } from "@/lib/metrics";

export async function GET() {
  const auth = await requireAdmin();
  if (isResponse(auth)) return auth;
  return NextResponse.json(dashboardPayload(getDb()));
}
