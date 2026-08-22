import { NextResponse } from "next/server";
import { getUserByUpn, getDb } from "@/lib/db";
import { issueSession, sessionCookie } from "@/lib/auth";

export async function POST(req: Request) {
  if ((process.env.AUTH_MODE || "development") === "entra") {
    return NextResponse.json({ error: "dev login disabled" }, { status: 403 });
  }
  const body = (await req.json()) as { email?: string };
  const email = body.email?.trim();
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
  const user = getUserByUpn(getDb(), email);
  const roles = user ? (JSON.parse(user.rolesJson) as string[]) : [];
  if (!user || !roles.some((r) => r === "Approver" || r === "PolicyAdmin")) {
    return NextResponse.json({ error: "not an admin" }, { status: 401 });
  }
  const token = await issueSession({
    email: user.userPrincipalName,
    name: user.displayName,
    roles: roles.filter((r) => r === "Approver" || r === "PolicyAdmin") as Array<
      "Approver" | "PolicyAdmin"
    >,
  });
  const res = new NextResponse(null, { status: 204 });
  const cookie = sessionCookie(token);
  res.cookies.set(cookie);
  return res;
}
