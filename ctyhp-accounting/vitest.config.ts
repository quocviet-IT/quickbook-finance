import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  oxc: {
    // lib/design/status.tsx carries JSX. React 19's automatic runtime means no
    // React import is needed in the source file.
    //
    // Configured through `oxc`, not `esbuild`: this Vite builds with Rolldown,
    // where the `esbuild` block is a deprecated shim it converts internally —
    // and whose types come from a package that is not even installed here, so
    // setting it needed an `as any` that switched off checking for the whole
    // block.
    jsx: { runtime: "automatic" },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
