import "fake-indexeddb/auto";
import { db } from "../src/db/db";
import {
  CORE_WIDGETS,
  deleteWidget,
  ensureDefaultWidgets,
  isCoreWidget,
  listWidgets,
  readWidgetTombstones,
  saveWidget,
  WIDGET_ID_PATTERN,
} from "../src/db/widgets";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

await db.delete();
await db.open();

// ---- widget store ----

await ensureDefaultWidgets();
let widgets = await listWidgets();
assert(widgets.map((w) => w.id).join(",") === "calendar,noted-days", "core widgets must seed in rail order");
assert(widgets[0].type === "calendar" && widgets[1].type === "day-list", "core widgets must have their fixed types");
assert(widgets.every((w) => w.enabled), "core widgets must seed enabled");
assert(widgets.every((w) => w.updatedAt === 0), "seeds must stamp updatedAt 0 so any disk copy wins the first merge");
assert(widgets[1].title === "noted days", "noted-days must keep its heading");

await saveWidget({ ...widgets[1], enabled: false, updatedAt: 123 });
await ensureDefaultWidgets();
widgets = await listWidgets();
assert(widgets.find((w) => w.id === "noted-days")?.enabled === false, "re-seeding must never overwrite user edits");
assert(CORE_WIDGETS.length === 2, "exactly two core widgets");

await saveWidget({
  id: "streak",
  type: "counter",
  title: "streak",
  config: { source: "streak", format: "{n} days" },
  order: 2,
  enabled: true,
  updatedAt: Date.now(),
});
widgets = await listWidgets();
assert(widgets.length === 3 && widgets[2].id === "streak", "listWidgets must sort ascending by order");

assert(isCoreWidget("calendar") && isCoreWidget("noted-days") && !isCoreWidget("streak"), "core ids are fixed");
let coreDeleteThrew = false;
try {
  await deleteWidget("calendar");
} catch {
  coreDeleteThrew = true;
}
assert(coreDeleteThrew, "deleting a core widget must throw");
await deleteWidget("streak");
assert((await listWidgets()).length === 2, "deleteWidget must remove custom rows");
assert((await readWidgetTombstones()).streak > 0, "deleteWidget must leave a tombstone");
await saveWidget({ id: "streak", type: "counter", title: "streak", config: {}, order: 2, enabled: true, updatedAt: Date.now() });
assert(!("streak" in (await readWidgetTombstones())), "re-saving an id must clear its tombstone");
await deleteWidget("streak");

assert(WIDGET_ID_PATTERN.test("my-widget-2"), "slug ids must pass the pattern");
assert(!WIDGET_ID_PATTERN.test("My Widget") && !WIDGET_ID_PATTERN.test("-x") && !WIDGET_ID_PATTERN.test(""), "non-slugs must fail the pattern");

// ---- data sources (pure — no db) ----
import {
  computeSource,
  contentDateKeys,
  isSourceId,
  notedDayRows,
  openTasks,
  sourceOptions,
  streakCount,
  type WidgetDataInput,
} from "../src/widgets/sources";

function day(date: string, main: string, margin = ""): import("../src/db/db").DayRow {
  return { date, main, margin, createdAt: 1, updatedAt: 1 };
}

const input: WidgetDataInput = {
  today: new Date(2026, 6, 6), // 2026-07-06, local time like the app's `today`
  todayKey: "2026-07-06",
  todayText: "# monday\n- [ ] ship the plan\nsome words here",
  contentDays: [
    day("2026-07-05", "- [x] done thing\n- [ ] carry over"),
    day("2026-07-04", "quiet day"),
    day("2026-07-01", "", "margin only note"),
  ],
};

const keys = contentDateKeys(input);
assert(keys.has("2026-07-06") && keys.has("2026-07-01") && keys.size === 4, "live today text and margin-only days both count as content");

const noted = notedDayRows(input);
assert(noted[0].date === "2026-07-06" && noted[0].excerpt === "monday", "today rides the live editor text, markdown stripped");
assert(noted.find((row) => row.date === "2026-07-01")?.excerpt === "margin only note", "margin-only day falls back to margin excerpt");
assert(notedDayRows(input, 2).length === 2, "limit caps rows");
assert(notedDayRows(input, 50, "oldest")[0].date === "2026-07-01", "oldest order flips the sort");

assert(streakCount(input) === 3, "streak counts consecutive noted days ending today (6,5,4)");
const noToday: WidgetDataInput = { ...input, todayText: "" };
assert(streakCount(noToday) === 2, "unnoted today falls back to a streak ending yesterday (5,4)");

const tasks = openTasks(input);
assert(tasks.length === 2, "open tasks: one in live today, one on the 5th (checked one excluded)");
assert(tasks[0].date === "2026-07-06" && tasks[0].text === "ship the plan", "tasks sort newest day first");
assert(openTasks(input, 1).length === 1, "days window excludes older tasks");
assert(openTasks(input, 30, 1).length === 1, "limit caps tasks");

assert(computeSource("noted-days", input) === 4, "noted-days source counts content days");
assert(computeSource("open-tasks", input) === 2, "open-tasks source counts unchecked boxes");
assert(computeSource("streak", input) === 3, "streak source matches streakCount");
assert(computeSource("words-today", input) > 0 && computeSource("words-total", input) > computeSource("words-today", input), "word counts are positive and total exceeds today");
assert(isSourceId("streak") && !isSourceId("nope"), "isSourceId guards the union");
assert(sourceOptions.length === 5, "five sources are exposed to the settings form");

await db.delete();
console.log("runtime asserts passed");
