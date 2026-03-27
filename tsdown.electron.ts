/**
 * tsdown config for Electron main + preload processes.
 *
 * Outputs to dist-electron/:
 *   main.mjs    — Electron main process
 *   preload.mjs — Preload script (contextBridge)
 */

import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    main: "src-electron/main.ts",
    preload: "src-electron/preload.ts",
  },
  outDir: "dist-electron",
  format: "esm",
  platform: "node",
  target: "node20",
  external: ["electron"],
  clean: true,
});
