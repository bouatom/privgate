import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { sessionSecret } from "./lib/secrets";

/**
 * Cheap edge pre-filter only: it proves the cookie carries a signature we issued.
 * It cannot reach SQLite, so it cannot tell whether the portal user has since been
 * disabled or stripped of every permission. The console layout re-resolves the
 * session against the database and redirects, which is the real authorization
 * boundary — do not treat a middleware pass as authorization.
 */
export async function middleware(req: NextRequest) {
  const res = await authorize(req);
  // Next.js injects X-Powered-By: Next.js at a layer below headers(). Neutralize
  // it here so the installed product does not advertise its web framework.
  res.headers.delete("X-Powered-By");
  res.headers.set("X-Powered-By", "PrivGate");
  return res;
}

async function authorize(req: NextRequest): Promise<NextResponse> {
  const token = req.cookies.get("privgate_session")?.value;
  if (!token) {
    const login = new URL("/login", req.url);
    login.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  try {
    await jwtVerify(token, new TextEncoder().encode(sessionSecret()));
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
