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

const appSource = readFileSync("src/app.tsx", "utf8");
assert(appSource.includes("ensureDefaultWidgets"), "app must seed core widgets on load");
assert(!appSource.includes("db.widgets."), "app.tsx must go through the widget store, never db.widgets directly");
assert(!rail.includes("db.widgets."), "Rail must go through the widget store, never db.widgets directly");

console.log("widgets verification passed");
