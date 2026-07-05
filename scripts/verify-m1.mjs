import { readFileSync, statSync } from "node:fs";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoRemoteRefs(path) {
  const source = readFileSync(path, "utf8");
  assert(!/https?:\/\//i.test(source), `${path} must not contain remote URLs`);
}

function assertPng(path) {
  const header = readFileSync(path).subarray(0, 8).toString("hex");
  assert(header === "89504e470d0a1a0a", `${path} must be a PNG`);
  assert(statSync(path).size > 100, `${path} must not be empty`);
}

const manifest = readJson("manifest.json");
const distManifest = readJson("dist/manifest.json");

for (const [label, data] of [
  ["manifest.json", manifest],
  ["dist/manifest.json", distManifest],
]) {
  assert(data.manifest_version === 3, `${label} must use Manifest V3`);
  assert(data.chrome_url_overrides?.newtab === "index.html", `${label} must override the new tab page`);
  assert(Array.isArray(data.permissions), `${label} must declare permissions as an array`);
  assert(data.permissions.length === 0, `${label} must request zero permissions`);
  assert(!("background" in data), `${label} must not define a background worker`);
  assert(!("content_scripts" in data), `${label} must not define content scripts`);
  assert(!("host_permissions" in data), `${label} must not request host permissions`);
}

assertNoRemoteRefs("index.html");
assertNoRemoteRefs("dist/index.html");

for (const size of [16, 48, 128]) {
  assertPng(`public/icons/${size}.png`);
  assertPng(`dist/icons/${size}.png`);
}

const tokens = readFileSync("src/styles/tokens.css", "utf8");
for (const token of ["--bg", "--surface", "--ink", "--muted", "--faint", "--line", "--accent", "--accent-soft", "--done"]) {
  assert(tokens.includes(token), `tokens.css must define ${token}`);
}

const appSource = readFileSync("src/app.tsx", "utf8");
assert(appSource.includes("readThemePreference"), "theme preference must initialize from storage");
assert(appSource.includes("prefers-color-scheme: dark"), "system theme tracking must be wired");
const daySectionSource = readFileSync("src/timeline/DaySection.tsx", "utf8");
assert(daySectionSource.includes("autofocus={isToday}"), "today surface must request focus for M1 shell");

console.log("M1 verification passed");
