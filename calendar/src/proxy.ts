import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Optimistic check only — just "is there a session cookie at all", for
// redirect UX. It can't verify the session is real (expired, revoked, or
// forged) without a DB call, and Proxy shouldn't do DB lookups (see
// node_modules/next/dist/docs/.../guides/authentication.md). The actual
// security boundary is requireUser()/getCurrentUser() in src/lib/auth.ts,
// called by every page and server action — this only saves a signed-out
// visitor a round trip to find out they need to log in.
// /api/test/ routes are for the Playwright suite's own setup/cleanup
// (testRoutesAllowed() gates them independently — off unless
// E2E_TEST_ROUTES=1 is set, so exempting them here doesn't weaken
// anything). They need to be reachable without a session cookie:
// Playwright's `request` fixture used for cleanup doesn't share the
// page's cookies, so without this exemption every afterEach cleanup
// call was silently redirecting to /login and never actually running —
// a real, no-op-but-looks-successful gap this proxy check created.
const PUBLIC_PATH_PREFIXES = ["/book/", "/login", "/signup", "/api/test/"];
const SESSION_COOKIE = "marvis_session";

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (hasSessionCookie) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
