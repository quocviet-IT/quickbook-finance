import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  esbuild: {
    // lib/design/status.tsx carries JSX. React 19's automatic runtime means no
    // React import is needed in the source file.
    jsx: "automatic",
  } as any,
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
