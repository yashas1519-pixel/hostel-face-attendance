import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Server-side route guard — runs on the Edge before any page renders.
 * Checks for the admin_token cookie (set on login).
 * Client-side localStorage can't be read here, so we also accept a cookie.
 *
 * Note: JWT signature is NOT verified here (Edge runtime can't load jsonwebtoken).
 * This is presence-only check — the backend verifies the token on every API call.
 * A missing/expired token will cause 401s from the API which trigger client-side
 * logout in fetchWithAuth.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Get token from cookie (set by login page) or skip (localStorage only)
  const token =
    req.cookies.get("admin_token")?.value ??
    req.headers.get("x-auth-token");

  const isAdminRoute   = pathname.startsWith("/dashboard");
  const isStudentRoute = pathname.startsWith("/student");
  const isLoginPage    = pathname === "/login";

  // Redirect to login if hitting a protected route without a token
  if ((isAdminRoute || isStudentRoute) && !token) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Redirect away from login if already has a token
  if (isLoginPage && token) {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/student/:path*", "/login"],
};
