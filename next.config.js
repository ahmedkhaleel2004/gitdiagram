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
    ];
  },
  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
};

export default config;
