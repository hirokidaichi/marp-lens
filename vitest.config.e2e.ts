import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/e2e/**/*.test.ts"],
    testTimeout: 300000, // 5 minutes for API calls
    hookTimeout: 300000,
  },
});
