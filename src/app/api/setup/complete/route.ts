import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { portalNeedsSetup } from "@/lib/portal";
import { completeWizard } from "@/lib/setup-state";

export async function POST() {
  const db = getDb();
  if (portalNeedsSetup(db)) {
    return NextResponse.json({ error: "create an administrator first" }, { status: 409 });
  }
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  completeWizard(db);
  return NextResponse.json({ ok: true });
}
