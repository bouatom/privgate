import { NextResponse } from "next/server";
import { deviceDetail, getDb } from "@/lib/db";
import { isResponse, requireAdmin } from "@/lib/http";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (isResponse(auth)) return auth;
  const { id } = await ctx.params;
  const detail = deviceDetail(getDb(), id);
  if (!detail) return NextResponse.json({ error: "unknown device" }, { status: 404 });
  return NextResponse.json(detail);
}
