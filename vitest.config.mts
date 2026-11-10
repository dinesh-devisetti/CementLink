import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    pool: "threads",
    maxWorkers: 2,
    coverage: { provider: "v8", include: ["src/server/**", "src/lib/**"] },
  },
});
