import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await build({
  entryPoints: ["scripts/verify-m4-runtime.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: "/tmp/daybook-verify-m4-runtime.mjs",
  logLevel: "silent",
});

await import(`${pathToFileURL("/tmp/daybook-verify-m4-runtime.mjs").href}?t=${Date.now()}`);

const timeline = readFileSync("src/timeline/Timeline.tsx", "utf8");
for (const required of ["IntersectionObserver", "pendingTopExtension", "scrollTo", "jump-highlight", "buildTimelineWindow"]) {
  assert(timeline.includes(required), `timeline must include ${required}`);
}

const app = readFileSync("src/app.tsx", "utf8");
for (const required of ["useToday", "jumpTarget", "onJumpToDate", "changeDayText"]) {
  assert(app.includes(required), `app must wire ${required}`);
}

const staticDay = readFileSync("src/timeline/StaticDay.tsx", "utf8");
assert(staticDay.includes("MarkdownIt"), "static day fallback must use markdown-it");
assert(staticDay.includes("toggleTaskLine"), "static day fallback must support task toggles");

console.log("M4 verification passed");
