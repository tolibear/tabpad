import "fake-indexeddb/auto";
import { db } from "../src/db/db";
import { getDay, hasDayContent, listContentDays, saveDayMargin } from "../src/db/days";
import { getPanel, savePanel } from "../src/db/panels";
import { getSettings, saveSettings } from "../src/db/settings";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

await db.delete();
await db.open();

const marginOnly = await saveDayMargin("2026-07-05", "side note");
assert(marginOnly?.main === "", "margin-only saves must preserve an empty main note");
assert(marginOnly?.margin === "side note", "margin-only saves must write the margin field");
assert(hasDayContent("", "side note"), "margin text must count as day content");
assert((await getDay("2026-07-05"))?.margin === "side note", "margin text must be readable");

const contentDays = await listContentDays(undefined, 10);
assert(contentDays.some((row) => row.date === "2026-07-05"), "margin-only days must enter content-day lists");

await savePanel("scratchpad", "scratch");
await savePanel("masterList", "master");
assert((await getPanel("scratchpad")).content === "scratch", "scratchpad must persist independently");
assert((await getPanel("masterList")).content === "master", "master list must persist independently");

await saveSettings({ rightPanel: "margin", editorSize: "lg", weekStartsOn: 1 });
const settings = await getSettings();
assert(settings.rightPanel === "margin", "right-panel mode must persist");
assert(settings.editorSize === "lg", "editor size must persist");
assert(settings.weekStartsOn === 1, "calendar week start must persist");
assert(settings.mirrorEnabled === false, "folder mirror must remain off by default");

await db.delete();
