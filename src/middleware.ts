import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const sessionSecret = new TextEncoder().encode(
  process.env.SESSION_SECRET || "dev-only-session-secret-change-me",
);

export async function middleware(req: NextRequest) {
  const token = req.cookies.get("privgate_session")?.value;
  if (!token) {
    const login = new URL("/login", req.url);
    login.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  try {
    await jwtVerify(token, sessionSecret);
    return NextResponse.next();
  } catch {
    const login = new URL("/login", req.url);
    return NextResponse.redirect(login);
  }
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/requests/:path*",
    "/devices/:path*",
    "/allowlists/:path*",
    "/users/:path*",
    "/jit/:path*",
    "/audit/:path*",
    "/configuration/:path*",
  ],
};
