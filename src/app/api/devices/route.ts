import { NextResponse } from "next/server";
import { getDb, listDeviceSummaries, enrollDevice, appendAudit } from "@/lib/db";
import { isResponse, requireAdmin } from "@/lib/http";

export async function GET() {
  const auth = await requireAdmin();
  if (isResponse(auth)) return auth;
  return NextResponse.json(listDeviceSummaries(getDb()));
}

export async function POST(req: Request) {
  const auth = await requireAdmin("PolicyAdmin");
  if (isResponse(auth)) return auth;
  const body = (await req.json()) as { hostname?: string; joinType?: string };
  if (!body.hostname) return NextResponse.json({ error: "hostname required" }, { status: 400 });
  const db = getDb();
  const enrolled = enrollDevice(
    db,
    body.hostname,
    body.joinType || "hybrid",
    process.env.DEVICE_SECRET_KEY || "dev-device-secret-key-32bytes!!",
  );
  appendAudit(db, auth.session.email, "device.enroll", enrolled.id, { hostname: enrolled.hostname });
  return NextResponse.json(enrolled, { status: 201 });
}
