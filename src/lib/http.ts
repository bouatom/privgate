import "server-only";
import { NextResponse } from "next/server";
import { can, getSession, type AdminSession } from "./auth";
import type { PermissionId } from "./permissions";

export async function requireAdmin(
  permission?: PermissionId | PermissionId[],
): Promise<{ session: AdminSession } | NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (permission && !can(session, permission)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return { session };
}

export async function requireAny(
  permissions: PermissionId[],
): Promise<{ session: AdminSession } | NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!permissions.some((p) => can(session, p))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return { session };
}

export function isResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}
