/** @type {import("next").NextConfig} */
const config = {
  reactStrictMode: false,
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
  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
};

export default config;
