import { NextResponse } from "next/server";
import { verifyEnrollmentToken } from "@/lib/enrollment";
import { listClientBinaries } from "@/lib/client-package";

export async function GET(req: Request) {
  if (!verifyEnrollmentToken(req.headers.get("x-enrollment-token"))) {
    return NextResponse.json({ error: "invalid enrollment token" }, { status: 401 });
  }
  return NextResponse.json({ files: listClientBinaries() });
}
