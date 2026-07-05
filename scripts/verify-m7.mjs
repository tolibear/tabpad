import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await build({
  entryPoints: ["scripts/verify-m7-runtime.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: "/tmp/daybook-verify-m7-runtime.mjs",
  logLevel: "silent",
});

await import(`${pathToFileURL("/tmp/daybook-verify-m7-runtime.mjs").href}?t=${Date.now()}`);

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
assert(Array.isArray(manifest.permissions) && manifest.permissions.length === 0, "manifest must request zero permissions");
assert(!("host_permissions" in manifest), "manifest must not request host permissions");
assert(!("background" in manifest), "manifest must not define a background worker");
assert(!("content_scripts" in manifest), "manifest must not define content scripts");
assert(manifest.chrome_url_overrides?.newtab === "index.html", "manifest must override the new tab page");

if (existsSync("dist/manifest.json")) {
  const distManifest = JSON.parse(readFileSync("dist/manifest.json", "utf8"));
  assert(Array.isArray(distManifest.permissions) && distManifest.permissions.length === 0, "built manifest must request zero permissions");
  assert(!("host_permissions" in distManifest), "built manifest must not request host permissions");
}

const app = readFileSync("src/app.tsx", "utf8");
for (const required of [
  "pickMirrorDirectory",
  "writeFullMirror",
  "queueMirrorDay",
  "queueMirrorPanel",
  "requestStoragePersistence",
  "reconnectMirror",
]) {
  assert(app.includes(required), `app must wire ${required}`);
}

const mirror = readFileSync("src/mirror/mirror.ts", "utf8");
for (const required of [
  "showDirectoryPicker",
  "storeMirrorDirectory",
  "getMirrorDirectory",
  "queryPermission",
  "requestPermission",
  "writeFullMirror",
  "writeDayMirror",
  "writePanelMirror",
  "getDirectoryHandle",
  "createWritable",
]) {
  assert(mirror.includes(required), `mirror module must include ${required}`);
}
assert(!mirror.includes("removeEntry"), "mirror must never delete files");

const settings = readFileSync("src/settings/SettingsOverlay.tsx", "utf8");
for (const required of ["choose folder", "reconnect", "mirrorStatus", "edits made to these files outside daybook will be overwritten"]) {
  assert(settings.includes(required), `settings mirror UI must include ${required}`);
}

const rail = readFileSync("src/rail/Rail.tsx", "utf8");
assert(rail.includes("reconnect notes folder"), "rail must expose a reconnect chip");

const vite = readFileSync("vite.config.ts", "utf8");
for (const required of ["manualChunks", "editor", "vendor"]) {
  assert(vite.includes(required), `vite config must include ${required}`);
}

const sourceFiles = ["src/app.tsx", "src/db/export.ts", "src/mirror/mirror.ts", "src/settings/SettingsOverlay.tsx"];
for (const file of sourceFiles) {
  const source = readFileSync(file, "utf8");
  for (const forbidden of ["fetch(", "XMLHttpRequest", "sendBeacon(", "https://", "http://"]) {
    assert(!source.includes(forbidden), `${file} must not include network primitive ${forbidden}`);
  }
}

console.log("M7 verification passed");
