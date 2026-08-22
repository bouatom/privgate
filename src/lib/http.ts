import { NextResponse } from "next/server";
import { getSession, hasRole, type AdminSession } from "./auth";

export async function requireAdmin(
  role?: AdminSession["roles"][number],
): Promise<{ session: AdminSession } | NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (role && !hasRole(session, role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return { session };
}

export function isResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}
