import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await build({
  entryPoints: ["scripts/verify-m2-runtime.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: "/tmp/daybook-verify-m2-runtime.mjs",
  logLevel: "silent",
});

await import(`${pathToFileURL("/tmp/daybook-verify-m2-runtime.mjs").href}?t=${Date.now()}`);

const app = readFileSync("src/app.tsx", "utf8");
for (const required of ["saveDayFields", "createTabPadChannel", "createExportPayload", "importPayload", "savePanel"]) {
  assert(app.includes(required), `app must wire ${required}`);
}

const schema = readFileSync("src/db/db.ts", "utf8");
for (const table of ["days: \"date, updatedAt\"", "panels: \"id\"", "meta: \"id\""]) {
  assert(schema.includes(table), `Dexie schema missing ${table}`);
}

console.log("M2 verification passed");
