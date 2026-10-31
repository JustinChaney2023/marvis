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
// /api/v1/ and /api/mcp authenticate with a Bearer personal access token
// (requireApiUser), never a session cookie — redirecting them to /login
// here meant no API client could ever reach them.
// The manifest and app icons are fetched by the browser without cookies
// (that's how manifest fetches work), so they must never redirect.
const PUBLIC_PATH_PREFIXES = [
  "/book/",
  "/login",
  "/signup",
  "/api/test/",
  "/api/v1/",
  "/api/mcp",
  "/manifest.webmanifest",
  "/sw.js",
  // OAuth for MCP clients: discovery metadata, client registration, and
  // the code->token exchange are called server-to-server with no cookie.
  // (/oauth/authorize is deliberately NOT here — it needs a login.)
  "/.well-known/",
  "/oauth/register",
  "/oauth/token",
  "/icon",
  "/apple-icon",
  // Linked from Google's OAuth consent screen; must work signed out.
  "/privacy",
  "/terms",
];
const SESSION_COOKIE = "marvis_session";

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // "/" is the calendar when signed in and the public landing page when not
  // (src/app/page.tsx decides), so it never redirects to /login.
  if (pathname === "/" || isPublicPath(pathname)) return NextResponse.next();

  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (hasSessionCookie) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  // Keep the query string — /oauth/authorize?client_id=...&state=... has
  // to come back intact after signing in.
  loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // _next/webpack-hmr is dev mode's hot-reload websocket — routing a
  // protocol-upgrade request through this proxy at all (even when it's a
  // same-request no-op via NextResponse.next()) breaks the handshake when
  // self-hosted behind a reverse proxy: a signed-out request got a plain
  // 307 redirect back instead of the 101 Switching Protocols a WebSocket
  // client expects, which just looks like "the socket failed" in devtools
  // with no other clue. Not sensitive data, doesn't need auth-gating —
  // same treatment as _next/static/_next/image below.
  matcher: ["/((?!_next/static|_next/image|_next/webpack-hmr|favicon.ico).*)"],
};
