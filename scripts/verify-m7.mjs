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
// M7 originally forbade all deletion; the accepted erase-all-wipes-folder design now
// removes note files, but must copy non-empty content to .tabpad-trash first — assert that safety net
assert(mirror.includes("writeTrashCopy") && mirror.includes(".tabpad-trash"), "mirror deletions must trash non-empty content first");

const settings = readFileSync("src/settings/SettingsOverlay.tsx", "utf8");
// external edits are now synced in live (no longer clobbered), so the warning copy changed
for (const required of ["choose folder", "reconnect", "mirrorStatus", "your days live in this folder as plain .md files"]) {
  assert(settings.includes(required), `settings mirror UI must include ${required}`);
}

const rail = readFileSync("src/rail/Rail.tsx", "utf8");
assert(rail.includes("reconnect notes folder"), "rail must expose a reconnect chip");

const vite = readFileSync("vite.config.ts", "utf8");
for (const required of ["manualChunks", "editor", "vendor"]) {
  assert(vite.includes(required), `vite config must include ${required}`);
}

// invariant: no automatic network calls; user-clicked links in settings are allowed (56d86a2)
const sourceFiles = ["src/app.tsx", "src/db/export.ts", "src/mirror/mirror.ts", "src/settings/SettingsOverlay.tsx"];
for (const file of sourceFiles) {
  const source = readFileSync(file, "utf8");
  const forbidden = ["fetch(", "XMLHttpRequest", "sendBeacon("];
  // remote URL literals are banned in logic modules, but settings hosts intentional outbound <a href> links
  if (file !== "src/settings/SettingsOverlay.tsx") forbidden.push("https://", "http://");
  for (const primitive of forbidden) {
    assert(!source.includes(primitive), `${file} must not include network primitive ${primitive}`);
  }
}

console.log("M7 verification passed");
