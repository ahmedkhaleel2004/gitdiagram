import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Tests run in the Workers runtime (Miniflare), against the Worker and its
// Durable Object as wrangler.jsonc defines them, with a test secret.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          PRESENCE_SECRET: "s".repeat(40),
          SITE_ORIGIN: "https://site.example",
        },
      },
    }),
  ],
  test: {
    include: ["src/**/*.test.ts"],
  },
});
