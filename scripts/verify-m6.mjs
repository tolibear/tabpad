import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await build({
  entryPoints: ["scripts/verify-m6-runtime.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: "/tmp/daybook-verify-m6-runtime.mjs",
  logLevel: "silent",
});

await import(`${pathToFileURL("/tmp/daybook-verify-m6-runtime.mjs").href}?t=${Date.now()}`);

const app = readFileSync("src/app.tsx", "utf8");
for (const required of [
  "editorSize",
  "dayMargins",
  "panelTexts",
  "saveDayFields",
  "SettingsOverlay",
  "changeSettings",
]) {
  assert(app.includes(required), `app must include ${required}`);
}

const timeline = readFileSync("src/timeline/Timeline.tsx", "utf8");
for (const required of ["dayMargins", "showMargins", "onDayMarginChange", "onDayMarginBlur"]) {
  assert(timeline.includes(required), `timeline must include ${required}`);
}

const daySection = readFileSync("src/timeline/DaySection.tsx", "utf8");
for (const required of ["day-content-grid", "day-margin", "margin-editor", "onMarginChange"]) {
  assert(daySection.includes(required), `day section must include ${required}`);
}

// master-list panel and hidden/margin panel modes removed; the scratchpad
// surface is now the scratchpad widget in the right rail
const scratchpadWidget = readFileSync("src/widgets/ScratchpadWidget.tsx", "utf8");
for (const required of ["scratchpad"]) {
  assert(scratchpadWidget.includes(required), `scratchpad widget must include ${required}`);
}

const settings = readFileSync("src/settings/SettingsOverlay.tsx", "utf8");
for (const required of [
  "editorSizes",
  "weekStartsOn",
  "folder mirror",
  "onExport",
  "onImport",
  "everything lives in this browser profile",
]) {
  assert(settings.includes(required), `settings UI must include ${required}`);
}

const rail = readFileSync("src/rail/Rail.tsx", "utf8");
assert(rail.includes("onOpenSettings"), "rail settings gear must open settings");

const css = readFileSync("src/styles/app.css", "utf8");
for (const required of [
  "--editor-font-size",
  ".day-content-grid",
  ".day-margin",
  ".settings-sheet",
]) {
  assert(css.includes(required), `CSS must include ${required}`);
}

console.log("M6 verification passed");
