import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export type AdminSession = {
  email: string;
  name: string;
  roles: Array<"Approver" | "PolicyAdmin">;
};

const cookieName = "privgate_session";

const sessionSecret = new TextEncoder().encode(
  process.env.SESSION_SECRET || "dev-only-session-secret-change-me",
);

function secret(): Uint8Array {
  return sessionSecret;
}

export async function issueSession(admin: AdminSession): Promise<string> {
  return new SignJWT(admin)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(secret());
}

export async function readSessionFromToken(token: string): Promise<AdminSession | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    const roles = Array.isArray(payload.roles)
      ? (payload.roles as AdminSession["roles"])
      : [];
    if (!payload.email || roles.length === 0) return null;
    return {
      email: String(payload.email),
      name: String(payload.name ?? payload.email),
      roles,
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

export function hasRole(session: AdminSession, role: AdminSession["roles"][number]): boolean {
  return session.roles.includes(role);
}
