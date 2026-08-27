import { NextResponse } from "next/server";
import { loginPost } from "@/lib/login-helpers";

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not available" }, { status: 404 });
  }
  return loginPost(req);
}
