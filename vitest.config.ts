import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    maxWorkers: 4,
    projects: [
      {
        extends: true,
        test: {
          name: "server",
          environment: "node",
          include: ["src/server/**/*.test.ts", "src/app/api/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "client",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
          exclude: ["src/server/**/*.test.ts", "src/app/api/**/*.test.ts"],
        },
      },
    ],
  },
});
