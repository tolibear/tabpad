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

await db.delete();
console.log("runtime asserts passed");
