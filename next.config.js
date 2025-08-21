/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const allowedOrigins = [
  "localhost:3000",
  "localhost:3001",
  "localhost:3002",
  "localhost:3003",
  "localhost:3004",
  "localhost:3005",
  "localhost:3006",
  "localhost:3007",
  "localhost:3008",
  "localhost:3009",
  "localhost:3010",
  "127.0.0.1:3000",
  "127.0.0.1:3001",
  "127.0.0.1:3002",
  "127.0.0.1:3003",
  "127.0.0.1:3004",
  "127.0.0.1:3005",
  "127.0.0.1:3006",
  "127.0.0.1:3007",
  "127.0.0.1:3008",
  "127.0.0.1:3009",
  "127.0.0.1:3010",
];

if (process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
  const name = process.env.CODESPACE_NAME;
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  for (let port = 3000; port <= 3010; port++) {
    allowedOrigins.push(`${name}-${port}.${domain}`);
  }
}

// Resolve backend target: Codespaces forwarded URL or local
const backendTarget = (function () {
  const name = process.env.CODESPACE_NAME;
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  if (name && domain) {
    return `https://${name}-8000.${domain}`;
  }
  return "http://localhost:8000";
})();

const config = {
  reactStrictMode: false,
  experimental: {
    serverActions: {
      // Allow Server Actions to be invoked from forwarded hosts (Codespaces) and local dev
      allowedOrigins,
    },
  },
  async rewrites() {
    return [
      // Proxy backend API in dev/codespaces to avoid CORS
      {
  source: "/backend/:path*",
  destination: `${backendTarget}/:path*`,
      },
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
      {
        source: "/ingest/decide",
        destination: "https://us.i.posthog.com/decide",
      },
    ];
  },
  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
};

export default config;
