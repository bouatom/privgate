import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isResponse, requireAdmin, requireAny } from "@/lib/http";
import { publicDirectoryStatus, syncDirectory } from "@/lib/entra";

export async function GET() {
  const auth = await requireAny(["integrations.view", "integrations.manage"]);
  if (isResponse(auth)) return auth;
  return NextResponse.json(publicDirectoryStatus(getDb()));
}

export async function POST() {
  const auth = await requireAdmin("integrations.manage");
  if (isResponse(auth)) return auth;
  try {
    const result = await syncDirectory(getDb());
    return NextResponse.json({ ...publicDirectoryStatus(getDb()), ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Directory sync failed" },
      { status: 400 },
    );
  }
}
