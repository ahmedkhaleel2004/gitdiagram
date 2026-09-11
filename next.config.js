const isDevelopment = process.env.NODE_ENV !== "production";

// Defence in depth behind the diagram sanitization pipeline: if a DOMPurify
// bypass ever lands, `connect-src 'self'` still denies the injected code any
// way to phone home, and object/base/form rules deny the usual pivots.
//
// `script-src` keeps 'unsafe-inline' because Next.js emits inline bootstrap
// scripts; tightening it further requires nonces, which need a middleware that
// can stamp each response. PostHog is same-origin via the /phx9a rewrite and
// runs with `disable_external_dependency_loading`, so it needs no exception.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  // Tailwind and Mermaid's themeCSS both inject style elements at runtime.
  "style-src 'self' 'unsafe-inline'",
  // blob: and data: carry the rendered SVG through the PNG export path.
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

/** @type {import("next").NextConfig} */
const config = {
  reactStrictMode: false,
  ...(process.env.RAILWAY_DOCKER_BUILD === "1" ? { output: "standalone" } : {}),
  transpilePackages: ["@aws-sdk/client-s3"],
  async rewrites() {
    return [
      {
        source: "/phx9a/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/phx9a/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/favicon.ico",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
};

export default config;
