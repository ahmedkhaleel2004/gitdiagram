import { defineConfig } from "vitest/config";

// The router is pure (Web Crypto only), so it is tested in plain Node; the
// container class needs Cloudflare's runtime and is proven by deploying.
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
