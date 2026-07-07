import { pathToFileURL } from "node:url";
import { build } from "esbuild";

await build({
  entryPoints: ["scripts/verify-editor-runtime.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: "/tmp/tabpad-verify-editor-runtime.mjs",
  logLevel: "silent",
});

await import(`${pathToFileURL("/tmp/tabpad-verify-editor-runtime.mjs").href}?t=${Date.now()}`);
