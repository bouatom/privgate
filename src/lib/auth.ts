import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getDb } from "./db";
import { getPortalUserByEmail } from "./portal";
import { hasPermission as hasPerm, type PermissionId } from "./permissions";
import { sessionSecret } from "./secrets";

export type AdminSession = {
  id: string;
  email: string;
  name: string;
  roles: string[];
  permissions: PermissionId[];
};

const cookieName = "privgate_session";

// Resolved per call, not at module load, so a missing production secret surfaces
// as a request-time failure instead of breaking `next build`.
function secret(): Uint8Array {
  return new TextEncoder().encode(sessionSecret());
}

export async function issueSession(admin: { email: string; name: string; id?: string }): Promise<string> {
  return new SignJWT({ email: admin.email, name: admin.name, sub: admin.id || "" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(secret());
}

export async function readSessionFromToken(token: string): Promise<AdminSession | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    const email = String(payload.email || "");
    if (!email) return null;
    const portal = getPortalUserByEmail(getDb(), email);
    if (!portal || portal.disabled) return null;
    if (!portal.permissions.length) return null;
    return {
      id: portal.id,
      email: portal.email,
      name: portal.displayName,
      roles: portal.roleNames,
      permissions: portal.permissions,
    };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<AdminSession | null> {
  const jar = await cookies();
  const token = jar.get(cookieName)?.value;
  if (!token) return null;
  return readSessionFromToken(token);
}

export function sessionCookie(token: string) {
  return {
    name: cookieName,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  };
}

export function clearSessionCookie() {
  return {
    name: cookieName,
    value: "",
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
}

export function hasRole(session: AdminSession, role: string): boolean {
  return session.roles.includes(role);
}

export function can(session: AdminSession | null | undefined, permission: PermissionId | PermissionId[]): boolean {
  if (!session) return false;
  return hasPerm(session.permissions, permission);
}
