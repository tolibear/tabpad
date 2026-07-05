import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await build({
  entryPoints: ["scripts/verify-m3-runtime.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: "/tmp/daybook-verify-m3-runtime.mjs",
  logLevel: "silent",
});

await import(`${pathToFileURL("/tmp/daybook-verify-m3-runtime.mjs").href}?t=${Date.now()}`);

const daySection = readFileSync("src/timeline/DaySection.tsx", "utf8");
const rightPanel = readFileSync("src/panel/RightPanel.tsx", "utf8");
const app = readFileSync("src/app.tsx", "utf8");
assert(daySection.includes("EditorSurface"), "day sections must use the shared editor surface");
assert(rightPanel.includes("EditorSurface"), "fixed panels must use the shared editor surface");
assert(!app.includes("<textarea"), "app must not use textarea surfaces after M3");
assert(!daySection.includes("<textarea"), "day sections must not use textarea surfaces after M3");
assert(!rightPanel.includes("<textarea"), "fixed panels must not use textarea surfaces after M3");

const factory = readFileSync("src/editor/createEditor.ts", "utf8");
for (const required of ["markdownLanguage", "TaskList", "Strikethrough", "history()", "drawSelection()", "placeholder", "livePreview", "inputRules", "markdownKeymap", "daybookEditorTheme"]) {
  assert(factory.includes(required), `createEditor must include ${required}`);
}

const livePreview = readFileSync("src/editor/livePreview.ts", "utf8");
for (const required of ["CheckboxWidget", "cm-md-heading", "cm-md-link", "cm-rule-widget", "selectionLineNumbers"]) {
  assert(livePreview.includes(required), `live preview must include ${required}`);
}

const css = readFileSync("src/styles/app.css", "utf8");
for (const required of [".cm-task-widget", ".cm-md-h1", ".cm-md-code", ".cm-md-quote", ".cm-md-task-checked"]) {
  assert(css.includes(required), `editor CSS must include ${required}`);
}

console.log("M3 verification passed");
