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
  "rightPanelMode",
  "editorSize",
  "dayMargins",
  "panelTexts",
  "saveDayMargin",
  "SettingsOverlay",
  "changeSettings",
  "panel-",
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

const rightPanel = readFileSync("src/panel/RightPanel.tsx", "utf8");
for (const required of ["scratchpad", "masterList", "master list", "mode === \"hidden\"", "mode === \"margin\""]) {
  assert(rightPanel.includes(required), `right panel must include ${required}`);
}

const settings = readFileSync("src/settings/SettingsOverlay.tsx", "utf8");
for (const required of [
  "panelModes",
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
  ".app-shell.panel-hidden",
  ".app-shell.panel-margin",
  "--editor-font-size",
  ".day-content-grid",
  ".day-margin",
  ".settings-sheet",
]) {
  assert(css.includes(required), `CSS must include ${required}`);
}

console.log("M6 verification passed");
