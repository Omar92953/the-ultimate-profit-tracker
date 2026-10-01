import { defineConfig } from "vitest/config";

// Unit tests only need plain TypeScript, not the React Router / Shopify dev plugins.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
