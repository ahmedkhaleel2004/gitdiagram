import { defineConfig } from "vitest/config";

// Only the worker's pure parts (src/logic.ts) are tested here; the Durable
// Object itself needs the Workers runtime.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
