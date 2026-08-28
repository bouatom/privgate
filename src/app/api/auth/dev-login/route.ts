import { NextResponse } from "next/server";
import { loginPost } from "@/lib/login-helpers";
import { bodyTooLarge, maxBodyBytes } from "@/lib/request-guard";

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not available" }, { status: 404 });
  }
  if (bodyTooLarge(req, maxBodyBytes())) {
    return NextResponse.json({ error: "request body too large" }, { status: 413 });
  }
  return loginPost(req);
}
