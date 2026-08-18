import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// This app has no user system at all — everything assumes whoever has
// access to it IS the owner, EXCEPT /book/[slug], which is deliberately
// public (a shareable "book time with me" link). Sharing that link means
// its page bundle is public too, and every "use server" action in this
// app is a real, unauthenticated POST endpoint reachable by anyone who
// reads it out of the JS — not just the booking one. Once APP_PASSWORD is
// set, this gates everything except the public booking surface behind a
// single shared-secret cookie. Left unset, auth is off (the safe default
// for local dev before anything is shared).
const PUBLIC_PATH_PREFIXES = ["/book/", "/login"];
const AUTH_COOKIE = "marvis_auth";

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p));
}

export function middleware(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const cookie = request.cookies.get(AUTH_COOKIE)?.value;
  if (cookie === password) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
