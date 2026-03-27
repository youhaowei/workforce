/**
 * tsdown config for compiling the server to a single Node-compatible bundle.
 * Used by Electron production builds — the server runs as a forked child process.
 */

import { defineConfig } from "tsdown";
import { resolve } from "path";

export default defineConfig({
  entry: { index: "src/server/index.ts" },
  outDir: "dist-server",
  format: "esm",
  platform: "node",
  target: "node20",
  clean: true,
  // Bundle everything except Node built-ins
  noExternal: [/.*/],
  external: [
    // Node built-ins
    "fs", "path", "os", "url", "net", "http", "https", "stream", "crypto",
    "child_process", "events", "util", "buffer", "tty", "assert", "module",
    "worker_threads", "perf_hooks", "diagnostics_channel", "async_hooks",
    "string_decoder", "zlib", "querystring", "node:*",
    // Native addons that can't be bundled
    "fsevents",
  ],
  resolve: {
    alias: {
      "@": resolve("src"),
      "tracey": resolve("lib/tracey/src"),
      "unifai": resolve("lib/unifai/src"),
      "@wystack/types": resolve("lib/wystack/packages/types/src"),
      "@wystack/version": resolve("lib/wystack/packages/version/src"),
      "@wystack/db": resolve("lib/wystack/packages/db/src"),
      "@wystack/server": resolve("lib/wystack/packages/server/src"),
      "@wystack/client": resolve("lib/wystack/packages/client/src"),
      "@wystack/start": resolve("lib/wystack/packages/start/src"),
    },
  },
});
