const isDevelopment = process.env.NODE_ENV !== "production";

// The live-presence worker (workers/presence): every tab holds one socket to it.
const presenceOrigin = (() => {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_PRESENCE_URL ?? "");
    return /^wss?:$/.test(url.protocol) ? ` ${url.origin}` : "";
  } catch {
    return "";
  }
})();

// Defence in depth behind the diagram sanitization pipeline: if a DOMPurify
// bypass ever lands, `connect-src 'self'` still denies the injected code any
// way to phone home, and object/base/form rules deny the usual pivots.
//
// `script-src` keeps 'unsafe-inline' because Next.js emits inline bootstrap
// scripts; tightening it further requires nonces, which need a middleware that
// can stamp each response. PostHog and its recorder extensions are same-origin
// via the /phx9a rewrite, so they need no CSP exception.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  // Tailwind and Mermaid's themeCSS both inject style elements at runtime.
  "style-src 'self' 'unsafe-inline'",
  // blob: and data: carry the rendered SVG through the PNG export path.
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${presenceOrigin}`,
  "worker-src 'self' blob:",
  // Same-origin frames only: the explainer video stage (/video-engine).
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // Safari upgrades localhost assets to HTTPS too, which breaks HTTP dev servers.
  ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
].join("; ");

// The explainer stage renders model-written text, so it gets a stricter policy
// than the app: only same-origin script files run (no inline scripts or
// handlers), nothing can be fetched, and only our own pages may frame it.
const videoStagePolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join("; ");

// Explainer videos are rendered to MP4 in headless Chromium with ffmpeg. Both
// ship native binaries that must stay out of the bundle and be traced into the
// functions that launch them.
const videoRenderFiles = [
  "./node_modules/@sparticuz/chromium/bin/**",
  "./node_modules/ffmpeg-static/ffmpeg",
];

/** @type {import("next").NextConfig} */
const config = {
  reactStrictMode: false,
  serverExternalPackages: [
    "@sparticuz/chromium",
    "puppeteer-core",
    "ffmpeg-static",
  ],
  outputFileTracingIncludes: {
    "/api/video/render": videoRenderFiles,
    "/api/video/render/segment": videoRenderFiles,
    "/api/video/generate": videoRenderFiles,
  },
  allowedDevOrigins: ["127.0.0.1"],
  ...(process.env.RAILWAY_DOCKER_BUILD === "1" ? { output: "standalone" } : {}),
  transpilePackages: ["@aws-sdk/client-s3"],
  async redirects() {
    return [
      {
        source: "/sponsor",
        destination: "/advertise",
        permanent: true,
      },
      // Support replacing github.com in a file, branch, issue or pull-request URL.
      {
        source: "/:username/:repo/twitter-image",
        destination: "/:username/:repo/opengraph-image",
        permanent: true,
      },
      {
        source:
          "/:username/:repo/:view(tree|blob|issues|pull|pulls|commit|commits|releases|actions)/:path*",
        destination: "/:username/:repo",
        permanent: false,
      },
    ];
  },
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
      // Sponsor logos sit in the first screen, so skip the revalidation round
      // trip on repeat visits. Give a changed logo a new file name.
      {
        source: "/sponsors/:path*",
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
      // Must follow the catch-all rule: later rules override the same header.
      {
        source: "/video-engine/:path*",
        headers: [
          { key: "Content-Security-Policy", value: videoStagePolicy },
          // Engine code changes with the app, so it always revalidates.
          { key: "Cache-Control", value: "no-cache" },
        ],
      },
      {
        source: "/video-engine/assets/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
};

export default config;
