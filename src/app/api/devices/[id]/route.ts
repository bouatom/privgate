import { NextResponse } from "next/server";
import { deviceDetail, getDb } from "@/lib/db";
import { isResponse, requireAdmin } from "@/lib/http";
import { expireDueJit } from "@/lib/jit-expiry";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin("devices.view");
  if (isResponse(auth)) return auth;
  const { id } = await ctx.params;
  expireDueJit();
  const detail = deviceDetail(getDb(), id);
  if (!detail) return NextResponse.json({ error: "unknown device" }, { status: 404 });
  return NextResponse.json(detail);
}
