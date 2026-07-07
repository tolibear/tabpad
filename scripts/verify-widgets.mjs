import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await build({
  entryPoints: ["scripts/verify-widgets-runtime.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: "/tmp/tabpad-verify-widgets-runtime.mjs",
  logLevel: "silent",
});

await import(`${pathToFileURL("/tmp/tabpad-verify-widgets-runtime.mjs").href}?t=${Date.now()}`);

const rail = readFileSync("src/rail/Rail.tsx", "utf8");
assert(!rail.includes("MiniCalendar"), "Rail must not hardcode MiniCalendar");
assert(!rail.includes("function NotedDays"), "Rail must not hardcode NotedDays");
assert(rail.includes("WidgetShell"), "Rail must render widgets through WidgetShell");

assert(
  rail.includes("tabpad:folder-callout-dismissed:v1"),
  "Rail must persist the connect-folder callout dismissal under tabpad:folder-callout-dismissed:v1",
);

const onboardingSource = readFileSync("src/db/onboarding.ts", "utf8");
const todayNoteMatch = onboardingSource.match(/const TODAY_NOTE = `([\s\S]*?)`;/);
assert(todayNoteMatch, "onboarding.ts must define TODAY_NOTE");
const folderLine = todayNoteMatch[1].indexOf("connect a notes folder");
const focusLine = todayNoteMatch[1].indexOf("focus mode");
assert(folderLine !== -1, "TODAY_NOTE must include the connect-a-notes-folder line");
assert(focusLine !== -1, "TODAY_NOTE must include the focus-mode line");
assert(folderLine < focusLine, "TODAY_NOTE must list the folder line before the focus-mode line");

const appSource = readFileSync("src/app.tsx", "utf8");
assert(appSource.includes("ensureDefaultWidgets"), "app must seed core widgets on load");
assert(!appSource.includes("db.widgets."), "app.tsx must go through the widget store, never db.widgets directly");
assert(!rail.includes("db.widgets."), "Rail must go through the widget store, never db.widgets directly");

const broadcastSource = readFileSync("src/db/broadcast.ts", "utf8");
assert(broadcastSource.includes('type: "widgets"'), "broadcast union must carry widget changes");

const overlay = readFileSync("src/settings/SettingsOverlay.tsx", "utf8");
assert(overlay.includes("WidgetSettings"), "settings must render the widget manager");

const widgetSettings = readFileSync("src/settings/WidgetSettings.tsx", "utf8");
assert(widgetSettings.includes("left sidebar"), "WidgetSettings must show a 'left sidebar' section");
assert(widgetSettings.includes("right sidebar"), "WidgetSettings must show a 'right sidebar' section");

const timelineSource = readFileSync("src/timeline/Timeline.tsx", "utf8");
assert(timelineSource.includes("task-line-highlight"), "Timeline must highlight the jumped-to task line");

const mirrorSource = readFileSync("src/mirror/mirror.ts", "utf8");
assert(mirrorSource.includes("Sidebar widgets"), "AGENTS.md guide must document widgets");
assert(mirrorSource.includes("widgets/<slug>.json"), "tabpad.json manifest must name the widget files");
assert(mirrorSource.includes("widgets/<slug>.md"), "AGENTS.md guide must document the scratchpad widget json/md pairing");
assert(!mirrorSource.includes("noted days with excerpts"), "day-list copy must use 'days with notes', not 'noted days'");

// F7: tri-state to-dos — the editor cycles markers and classes in-progress
const checkboxSource = readFileSync("src/editor/checkbox.ts", "utf8");
assert(checkboxSource.includes("nextTaskMarker"), "the checkbox cycles markers via nextTaskMarker");
const livePreviewSource = readFileSync("src/editor/livePreview.ts", "utf8");
assert(livePreviewSource.includes("cm-md-task-progress"), "livePreview classes in-progress task lines");
const appCss = readFileSync("src/styles/app.css", "utf8");
assert(appCss.includes("cm-md-task-progress") && appCss.includes("input.cm-task-progress"), "app.css styles in-progress task text and checkbox");

console.log("widgets verification passed");
