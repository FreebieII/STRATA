// Vite builds the dashboard; Vitest (the `test` section) runs its unit tests.
//
// `npm run dev` serves the dashboard on http://127.0.0.1:5173 and forwards
// /api/* to a STRATA API running on this machine (`strata api`, port 8000),
// just as nginx does in the frontend container.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    // Never turn fonts or images into data: URIs; the Content-Security-Policy
    // only allows fonts served by the dashboard itself.
    assetsInlineLimit: 0,
    // Every browser the dashboard supports has modulepreload built in, and the
    // polyfill would be the only script not in a file.
    modulePreload: { polyfill: false },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
