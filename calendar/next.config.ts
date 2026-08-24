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
  // This app doesn't terminate TLS itself — a self-host is expected to
  // sit behind a reverse proxy (nginx/Caddy/etc.) handling HTTPS. Inert
  // over a plain-HTTP response (browsers only honor HSTS from a secure
  // context), so it's harmless to send unconditionally and just works
  // once a proxy is in front of this.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
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
      // https: (any host) so task notes can embed an externally-hosted
      // image link, not just ones uploaded through this app — the
      // realistic risk (an image src leaking a viewer's IP to a third
      // party) is the same one every note-taking/chat app with linked
      // images accepts; it's read-only, no script execution.
      "img-src 'self' data: https:",
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
  // Server Actions cap request bodies at 1MB by default, but the syllabus
  // importer accepts files up to MAX_CONVERT_BYTES (25MB) and hands them
  // to a server action. Those two limits contradicted each other, so any
  // real .docx/.pdf syllabus failed with "Body exceeded 1 MB limit"
  // before its own size check ever ran. Kept in step with
  // MAX_CONVERT_BYTES in src/lib/documentConvert.ts.
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
  // Lets dev-mode HMR work when accessing the dev server over Tailscale
  // instead of localhost — Next blocks cross-origin dev requests by
  // default. No effect on a production build.
  allowedDevOrigins: isDev ? ["100.93.49.60"] : undefined,
};

export default nextConfig;
