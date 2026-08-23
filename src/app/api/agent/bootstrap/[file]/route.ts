import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import { verifyEnrollmentToken } from "@/lib/enrollment";
import { clientBinaryPath } from "@/lib/client-package";

export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  if (!verifyEnrollmentToken(req.headers.get("x-enrollment-token"))) {
    return NextResponse.json({ error: "invalid enrollment token" }, { status: 401 });
  }
  const { file } = await ctx.params;
  const abs = clientBinaryPath(file);
  if (!abs) return NextResponse.json({ error: "unknown file" }, { status: 404 });
  const data = readFileSync(abs);
  return new NextResponse(data, {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${file}"`,
      "cache-control": "no-store",
    },
  });
}
