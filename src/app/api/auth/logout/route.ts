import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";

export async function POST(req: Request) {
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(clearSessionCookie(req));
  return res;
}
