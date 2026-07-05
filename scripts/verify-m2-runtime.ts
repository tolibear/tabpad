import "fake-indexeddb/auto";
import { db } from "../src/db/db";
import { firstLineExcerpt, getDay, hasDayContent, listContentDays, saveDayContent } from "../src/db/days";
import { createExportPayload, importPayload } from "../src/db/export";
import { getPanel, savePanel } from "../src/db/panels";
import { getSettings, saveSettings } from "../src/db/settings";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

await db.delete();
await db.open();

assert(!hasDayContent("   ", ""), "whitespace-only content must be empty");
const emptySave = await saveDayContent("2026-07-03", "   ");
assert(emptySave === null, "empty first save must not create a day row");

const savedDay = await saveDayContent("2026-07-03", "# plans\n- [ ] call max");
assert(savedDay?.date === "2026-07-03", "day row must save by local date key");
assert((await getDay("2026-07-03"))?.main.includes("plans"), "saved day must be readable");
assert(firstLineExcerpt(savedDay.main) === "plans", "excerpt must strip markdown markers");

await saveDayContent("2026-07-02", "packing list");
const contentDays = await listContentDays(undefined, 10);
assert(contentDays.map((row) => row.date).join(",") === "2026-07-03,2026-07-02", "content days must sort newest first");

const panel = await savePanel("scratchpad", "loose thread");
assert(panel.updatedAt > 0, "panel save must stamp updatedAt");
assert((await getPanel("scratchpad")).content === "loose thread", "panel content must be readable");

await saveSettings({ theme: "dark", weekStartsOn: 1 });
const settings = await getSettings();
assert(settings.theme === "dark" && settings.weekStartsOn === 1, "settings patch must persist");
assert(settings.rightPanel === "scratchpad", "settings must merge defaults");

const payload = await createExportPayload();
assert(payload.days.length === 2, "export must include days");
assert(payload.panels.length === 1, "export must include panels");

await importPayload({
  schemaVersion: 1,
  exportedAt: Date.now(),
  days: [
    { date: "2026-07-03", main: "older", margin: "", createdAt: 1, updatedAt: 1 },
    { date: "2026-07-04", main: "new", margin: "", createdAt: 2, updatedAt: Date.now() + 1000 },
  ],
  panels: [{ id: "masterList", content: "running", updatedAt: Date.now() + 1000 }],
  settings: { theme: "light" },
});

assert((await getDay("2026-07-03"))?.main.includes("plans"), "older import must not overwrite newer day");
assert((await getDay("2026-07-04"))?.main === "new", "new imported day must be saved");
assert((await getPanel("masterList")).content === "running", "new imported panel must be saved");

await db.delete();
