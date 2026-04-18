import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["**/*.d.ts", "**/node_modules/**", "**/.next/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `server-only` は import されると常に throw する「poison pill」モジュール
      // (Next.js bundler が検知して client import を禁止するための仕組み)。
      // Vitest の Node 環境では通常の import として実行されて全テストが落ちるため、
      // test 実行時のみ空モジュールに差し替える (issue #29)。
      "server-only": path.resolve(__dirname, "./src/test/server-only-stub.ts"),
    },
  },
});
