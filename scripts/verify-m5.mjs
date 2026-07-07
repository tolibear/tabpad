import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await build({
  entryPoints: ["scripts/verify-m5-runtime.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: "/tmp/daybook-verify-m5-runtime.mjs",
  logLevel: "silent",
});

await import(`${pathToFileURL("/tmp/daybook-verify-m5-runtime.mjs").href}?t=${Date.now()}`);

const rail = readFileSync("src/rail/Rail.tsx", "utf8");
for (const required of ["weekStartsOn", "currentTopKey", "onJumpToDate"]) {
  assert(rail.includes(required), `rail must include ${required}`);
}

// the calendar rendering moved out of Rail into its own widget — the same
// month-navigation internals now live here
const calendarWidget = readFileSync("src/widgets/CalendarWidget.tsx", "utf8");
for (const required of ["setVisibleMonth", "ChevronLeft", "ChevronRight", "calendarDays"]) {
  assert(calendarWidget.includes(required), `calendar widget must include ${required}`);
}

// noted-day detection moved into the widget data sources, where the calendar
// reads it through contentDateKeys
const widgetSources = readFileSync("src/widgets/sources.ts", "utf8");
assert(widgetSources.includes("hasDayContent"), "widget sources must include hasDayContent");

const palette = readFileSync("src/palette/CommandK.tsx", "utf8");
for (const required of ["metaKey", "ctrlKey", "parseDateJump", "Enter", "Escape", "onJumpToDate"]) {
  assert(palette.includes(required), `palette must include ${required}`);
}

const timeline = readFileSync("src/timeline/Timeline.tsx", "utf8");
for (const required of ["onTopDateChange", "reportTopDate", "addEventListener(\"scroll\"", ".cm-content"]) {
  assert(timeline.includes(required), `timeline scroll spy must include ${required}`);
}

const app = readFileSync("src/app.tsx", "utf8");
for (const required of ["<Rail", "<CommandK", "currentTopKey", "weekStartsOn", "onTopDateChange"]) {
  assert(app.includes(required), `app must wire ${required}`);
}

const css = readFileSync("src/styles/app.css", "utf8");
for (const required of [".palette-backdrop", ".palette-panel", ".noted-row.active", ".date-cell.noted::after"]) {
  assert(css.includes(required), `CSS must include ${required}`);
}

console.log("M5 verification passed");
