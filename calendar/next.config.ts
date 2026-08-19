import type { NextConfig } from "next";

// Baseline security headers — this app is heading toward being
// self-hosted with a public DNS name, so these cost nothing and close
// off a few classic attack classes: clickjacking (frame-ancestors),
// MIME-sniffing XSS (nosniff), and leaking full referrer URLs (which can
// contain the booking page's slug or other path info) to third parties.
// React's dev mode uses eval() for better stack traces (never in a
// production build) — script-src needs 'unsafe-eval' locally or every
// page throws in the browser console under this CSP. Kept out of the
// production header entirely.
const isDev = process.env.NODE_ENV !== "production";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    // 'unsafe-inline' on script-src is required for the pre-paint theme
    // script in layout.tsx (a fixed, non-user-controlled string) and for
    // Next's own inline hydration data — this is a real constraint of
    // how the App Router ships bootstrap data, not a shortcut taken here.
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
