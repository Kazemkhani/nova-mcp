import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Network is mocked in every test — fail fast if something leaks.
    testTimeout: 10_000,
  },
});
