import "fake-indexeddb/auto";
import { db } from "../src/db/db";
import {
  CORE_WIDGETS,
  deleteWidget,
  ensureDefaultWidgets,
  isCoreWidget,
  listWidgets,
  readWidgetTombstones,
  sanitizeColumn,
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
assert(widgets.map((w) => w.id).sort().join(",") === "calendar,noted-days,scratchpad", "three core widgets seed");
assert(widgets.find((w) => w.id === "calendar")?.type === "calendar", "calendar seeds with its fixed type");
assert(widgets.find((w) => w.id === "noted-days")?.type === "day-list", "noted-days seeds with its fixed type");
assert(widgets.find((w) => w.id === "scratchpad")?.type === "scratchpad", "scratchpad seeds as the sixth type");
assert(widgets.every((w) => w.enabled), "core widgets must seed enabled");
assert(widgets.every((w) => w.updatedAt === 0), "seeds must stamp updatedAt 0 so any disk copy wins the first merge");
assert(widgets.find((w) => w.id === "noted-days")?.title === "noted days", "noted-days must keep its heading");
assert(widgets.find((w) => w.id === "calendar")?.column === "left", "calendar seeds into the left column");
assert(widgets.find((w) => w.id === "noted-days")?.column === "left", "noted-days seeds into the left column");
assert(widgets.find((w) => w.id === "scratchpad")?.column === "right", "scratchpad seeds into the right column");

// sanitizeColumn: only the two known values pass; everything else defaults left
assert(sanitizeColumn("right") === "right" && sanitizeColumn("left") === "left", "sanitizeColumn keeps known columns");
assert(sanitizeColumn("middle") === "left" && sanitizeColumn(undefined) === "left" && sanitizeColumn(3) === "left", "sanitizeColumn defaults to left");

// backfill: an EXISTING row missing column gains "left" without a user-edit
// bump — the row's updatedAt is preserved so sync doesn't treat it as an edit
await db.widgets.put({ id: "calendar", type: "calendar", title: "", config: {}, order: 0, enabled: true, updatedAt: 42 } as never);
await ensureDefaultWidgets();
const backfilled = await db.widgets.get("calendar");
assert(backfilled?.column === "left", "ensureDefaultWidgets backfills column onto legacy rows");
assert(backfilled?.updatedAt === 42, "column backfill preserves updatedAt (not a user edit)");

await saveWidget({ ...widgets.find((w) => w.id === "noted-days")!, enabled: false, updatedAt: 123 });
await ensureDefaultWidgets();
widgets = await listWidgets();
assert(widgets.find((w) => w.id === "noted-days")?.enabled === false, "re-seeding must never overwrite user edits");
assert(CORE_WIDGETS.length === 3, "exactly three core widgets");
assert(isCoreWidget("scratchpad"), "scratchpad is a core widget");

// the legacy settings.scratchpad toggle seeds the scratchpad widget's enabled
// state EXACTLY ONCE: an install that had the panel off must not gain a
// surprise scratchpad, and a later widget toggle must not be re-clobbered
await db.delete();
await db.open();
await db.meta.put({ id: "settings", value: { scratchpad: false } });
await ensureDefaultWidgets();
assert((await listWidgets()).find((w) => w.id === "scratchpad")?.enabled === false, "legacy scratchpad=off seeds the widget disabled");
await saveWidget({ ...(await listWidgets()).find((w) => w.id === "scratchpad")!, enabled: true, updatedAt: 5 });
await ensureDefaultWidgets();
assert((await listWidgets()).find((w) => w.id === "scratchpad")?.enabled === true, "the legacy seed runs once — a later toggle sticks");
await db.delete();
await db.open();
await ensureDefaultWidgets();
assert((await listWidgets()).find((w) => w.id === "scratchpad")?.enabled === true, "a fresh install (no settings) seeds the scratchpad enabled");
widgets = await listWidgets();

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
assert(widgets.length === 4 && widgets[widgets.length - 1].id === "streak", "listWidgets must sort ascending by order");

assert(isCoreWidget("calendar") && isCoreWidget("noted-days") && !isCoreWidget("streak"), "core ids are fixed");
let coreDeleteThrew = false;
try {
  await deleteWidget("calendar");
} catch {
  coreDeleteThrew = true;
}
assert(coreDeleteThrew, "deleting a core widget must throw");
await deleteWidget("streak");
assert((await listWidgets()).length === 3, "deleteWidget must remove custom rows");
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

// ---- registry + sanitizers ----
import {
  isWidgetType,
  sanitizeCounterConfig,
  sanitizeDayListConfig,
  sanitizeScratchpadConfig,
  sanitizeTaskRollupConfig,
  sanitizeTextConfig,
  sanitizeWidgetConfig,
  widgetProblem,
  widgetRegistry,
  widgetTypes,
} from "../src/widgets/registry";

assert(widgetTypes.length === 6 && isWidgetType("scratchpad") && !isWidgetType("iframe"), "exactly six declarative types");
assert(Object.keys(widgetRegistry).length === 6, "registry covers every type");
for (const type of widgetTypes) {
  assert(widgetRegistry[type].label.length > 0 && widgetRegistry[type].description.length > 0, `registry entry for ${type} must be presentable`);
}

assert(sanitizeDayListConfig({}).limit === 50 && sanitizeDayListConfig({}).order === "newest", "day-list defaults");
assert(sanitizeDayListConfig({ limit: 9999, order: "oldest" }).limit === 200, "day-list limit clamps to 200");
assert(sanitizeDayListConfig({ limit: "abc" }).limit === 50, "non-numeric limit falls back");

assert(sanitizeCounterConfig({}).source === "streak" && sanitizeCounterConfig({}).format === "{n}", "counter defaults");
assert(sanitizeCounterConfig({ source: "bogus", format: "" }).source === "streak", "unknown source falls back");

assert(sanitizeTaskRollupConfig({ days: 0 }).days === 1 && sanitizeTaskRollupConfig({ days: 500 }).days === 90, "task-rollup days clamp 1–90");
assert(sanitizeTextConfig({ content: 42 }).content === "", "non-string text content falls back to empty");

assert(sanitizeScratchpadConfig({}).height === "full" && sanitizeScratchpadConfig({}).maxHeight === 480, "scratchpad defaults to full height, 480 max");
assert(sanitizeScratchpadConfig({ height: "fixed", maxHeight: 300 }).height === "fixed" && sanitizeScratchpadConfig({ height: "fixed", maxHeight: 300 }).maxHeight === 300, "scratchpad keeps a fixed height and in-range maxHeight");
assert(sanitizeScratchpadConfig({ maxHeight: 5000 }).maxHeight === 1200 && sanitizeScratchpadConfig({ maxHeight: 1 }).maxHeight === 160, "scratchpad maxHeight clamps to 160–1200");
assert(sanitizeScratchpadConfig({ height: "weird" }).height === "full", "unknown scratchpad height falls back to full");
assert((sanitizeWidgetConfig("scratchpad", { height: "fixed" }) as { height: string }).height === "fixed", "sanitizeWidgetConfig dispatches scratchpad");
assert(widgetProblem({ type: "scratchpad", config: {} }) === null, "scratchpad has no special render problem");

assert(sanitizeWidgetConfig("calendar", { junk: 1 }).junk === undefined, "calendar config is always empty");
assert((sanitizeWidgetConfig("counter", { source: "open-tasks" }) as { source: string }).source === "open-tasks", "sanitizeWidgetConfig dispatches per type");

assert(widgetProblem({ type: "counter", config: {} }) === null, "counter with defaults renders");
assert(widgetProblem({ type: "iframe" as never, config: {} })?.includes("unknown widget type"), "unknown type is a named problem");
assert(widgetProblem({ type: "text", config: { content: "  " } })?.includes("no content"), "empty text widget is a named problem");

// ---- widget mirror + sync ----
import {
  parseWidgetFile,
  removeWidgetMirrorFile,
  serializeWidgetFile,
  syncWithDisk,
  writeWidgetsMirror,
  type FileSystemDirectoryHandleLike,
  type WidgetFileIssue,
} from "../src/mirror/mirror";

// minimal in-memory FileSystemDirectoryHandleLike for sync tests
interface FakeDir {
  handle: FileSystemDirectoryHandleLike;
  files: Map<string, { text: string; lastModified: number }>;
  dirs: Map<string, FakeDir>;
}

function makeFakeDir(name = "root"): FakeDir {
  const files = new Map<string, { text: string; lastModified: number }>();
  const dirs = new Map<string, FakeDir>();
  const decoder = new TextDecoder();
  const handle: FileSystemDirectoryHandleLike = {
    name,
    async getFileHandle(fileName: string, options?: { create?: boolean }) {
      if (!files.has(fileName) && !options?.create) throw new Error(`NotFound: ${fileName}`);
      if (!files.has(fileName)) files.set(fileName, { text: "", lastModified: Date.now() });
      return {
        async createWritable() {
          const chunks: string[] = [];
          return {
            async write(data: BlobPart) {
              chunks.push(decoder.decode(data as Uint8Array));
            },
            async close() {
              files.set(fileName, { text: chunks.join(""), lastModified: Date.now() });
            },
          };
        },
        async getFile() {
          const file = files.get(fileName);
          if (!file) throw new Error(`NotFound: ${fileName}`);
          return Object.assign({ text: async () => file.text }, { lastModified: file.lastModified });
        },
      };
    },
    async getDirectoryHandle(dirName: string, options?: { create?: boolean }) {
      if (!dirs.has(dirName) && !options?.create) throw new Error(`NotFound: ${dirName}`);
      if (!dirs.has(dirName)) dirs.set(dirName, makeFakeDir(dirName));
      return dirs.get(dirName)!.handle;
    },
    async removeEntry(entryName: string) {
      files.delete(entryName);
      dirs.delete(entryName);
    },
    values: async function* () {
      for (const fileName of files.keys()) yield { kind: "file" as const, name: fileName };
      for (const dirName of dirs.keys()) yield { kind: "directory" as const, name: dirName };
    },
  };
  return { handle, files, dirs };
}

await db.open();
await ensureDefaultWidgets();

// serialize/parse round-trip
const roundTrip = parseWidgetFile("streak", serializeWidgetFile({
  id: "streak", type: "counter", title: "streak", config: { source: "streak", format: "{n}" }, order: 2, enabled: true, updatedAt: 5,
}));
assert("row" in roundTrip && roundTrip.row.type === "counter" && roundTrip.row.order === 2, "widget file round-trips");
assert("error" in parseWidgetFile("x", "{nope"), "broken JSON is a named error");
assert("error" in parseWidgetFile("x", JSON.stringify({ type: "iframe" })), "unknown type is a named error");

// forward-compat: fields this version doesn't know (e.g. a future `column`)
// must survive the file → row → file round-trip, so an older app never
// strips a newer app's data from widgets/*.json
const futureFile = JSON.stringify({ type: "counter", title: "streak", enabled: true, order: 2, config: {}, column: "right", futureFlag: 7 });
const futureParsed = parseWidgetFile("streak", futureFile);
assert("row" in futureParsed && (futureParsed.row as Record<string, unknown>).column === "right", "unknown top-level fields survive parsing");
assert("row" in futureParsed && (futureParsed.row as Record<string, unknown>).futureFlag === 7, "all unknown fields ride along, not just known-future ones");
assert("row" in futureParsed && futureParsed.row.id === "streak", "a stray id field in the file can never override the filename id");
const futureRewritten = "row" in futureParsed ? serializeWidgetFile({ ...futureParsed.row, updatedAt: 1 } as import("../src/db/db").WidgetRow) : "";
assert(JSON.parse(futureRewritten).column === "right" && JSON.parse(futureRewritten).futureFlag === 7, "unknown fields survive re-serialization");
assert(!("id" in JSON.parse(futureRewritten)) && !("updatedAt" in JSON.parse(futureRewritten)), "id stays in the filename and updatedAt stays local");

// column is a validated known field: "right" rides through, garbage and
// absence both sanitize to "left" — while OTHER unknown fields still survive
const colRight = parseWidgetFile("streak", JSON.stringify({ type: "counter", title: "s", enabled: true, order: 1, config: {}, column: "right", futureFlag: 7 }));
assert("row" in colRight && colRight.row.column === "right", "parseWidgetFile keeps a valid column");
assert("row" in colRight && (colRight.row as Record<string, unknown>).futureFlag === 7, "known column validation leaves other unknown fields intact");
const colBad = parseWidgetFile("streak", JSON.stringify({ type: "counter", title: "s", enabled: true, order: 1, config: {}, column: "sideways" }));
assert("row" in colBad && colBad.row.column === "left", "garbage column sanitizes to left");
const colNone = parseWidgetFile("streak", JSON.stringify({ type: "counter", title: "s", enabled: true, order: 1, config: {} }));
assert("row" in colNone && colNone.row.column === "left", "absent column defaults to left");
assert(JSON.parse(serializeWidgetFile({ id: "streak", type: "counter", title: "s", config: {}, order: 1, enabled: true, column: "right", updatedAt: 1 })).column === "right", "serializeWidgetFile includes column explicitly");

// app → disk: mirror writes every row as widgets/<id>.json
const root = makeFakeDir();
await writeWidgetsMirror(root.handle, await listWidgets());
const widgetsDir = root.dirs.get("widgets");
assert(widgetsDir?.files.has("calendar.json") && widgetsDir.files.has("noted-days.json"), "mirror writes core widget files");

// disk → app: an agent-authored file imports as a new widget
widgetsDir!.files.set("moon.json", {
  text: JSON.stringify({ type: "text", title: "moon", enabled: true, order: 9, config: { content: "waxing" } }),
  lastModified: Date.now() - 5_000,
});
let issues: WidgetFileIssue[] = [];
await syncWithDisk(root.handle, undefined, undefined, (list) => { issues = list; });
const moon = (await listWidgets()).find((w) => w.id === "moon");
assert(moon?.type === "text" && (moon.config as { content: string }).content === "waxing", "agent widget file imports");
assert(issues.length === 0, "valid files report no issues");

// invalid file: reported, not imported, not clobbered
widgetsDir!.files.set("broken.json", { text: "{not json", lastModified: Date.now() - 5_000 });
await syncWithDisk(root.handle, undefined, undefined, (list) => { issues = list; });
assert(issues.some((issue) => issue.file === "widgets/broken.json"), "invalid widget file is a reported issue");
assert(!(await listWidgets()).some((w) => w.id === "broken"), "invalid widget file must not import");
assert(widgetsDir!.files.get("broken.json")!.text === "{not json", "invalid file must not be overwritten");

// core protection: a file changing a core widget's type is an issue, not an import
widgetsDir!.files.set("calendar.json", {
  text: JSON.stringify({ type: "text", title: "calendar", enabled: true, order: 0, config: { content: "x" } }),
  lastModified: Date.now() + 60_000, // even a newer stamp must not win
});
await syncWithDisk(root.handle, undefined, undefined, (list) => { issues = list; });
assert((await listWidgets()).find((w) => w.id === "calendar")?.type === "calendar", "core widget type is immutable via files");
assert(issues.some((issue) => issue.file === "widgets/calendar.json"), "core type change reports an issue");

// app newer → pushes back to disk
const moonRow = (await listWidgets()).find((w) => w.id === "moon")!;
await saveWidget({ ...moonRow, title: "moon phase", updatedAt: Date.now() });
await syncWithDisk(root.handle, undefined, undefined, () => {});
assert(widgetsDir!.files.get("moon.json")!.text.includes("moon phase"), "app-newer widget pushes back to disk");

// delete removes the file (with a trash copy)
await removeWidgetMirrorFile(root.handle, "moon");
assert(!widgetsDir!.files.has("moon.json"), "removeWidgetMirrorFile deletes the file");
assert([...root.dirs.get(".tabpad-trash")?.files.keys() ?? []].some((n) => n.includes("moon")), "deleted widget file lands in trash");

// tombstone: an in-app delete + a STALE leftover file must not resurrect —
// the sync pass removes the file instead
widgetsDir!.files.set("ghost.json", {
  text: JSON.stringify({ type: "text", title: "ghost", enabled: true, order: 8, config: { content: "boo" } }),
  lastModified: Date.now() - 5_000,
});
await syncWithDisk(root.handle, undefined, undefined, () => {});
assert((await listWidgets()).some((w) => w.id === "ghost"), "ghost imports first");
await deleteWidget("ghost");
// note: NO removeWidgetMirrorFile — simulates the delete happening in a tab
// without the folder connection; the stale file is still on disk
await syncWithDisk(root.handle, undefined, undefined, () => {});
assert(!(await listWidgets()).some((w) => w.id === "ghost"), "tombstoned widget must not resurrect from a stale file");
assert(!widgetsDir!.files.has("ghost.json"), "the stale file is cleaned up by the sync pass");

// …but a file RE-CREATED after the deletion is intentional and imports
widgetsDir!.files.set("ghost.json", {
  text: JSON.stringify({ type: "text", title: "ghost2", enabled: true, order: 8, config: { content: "back" } }),
  lastModified: Date.now() + 1_000, // newer than the tombstone
});
await syncWithDisk(root.handle, undefined, undefined, () => {});
assert((await listWidgets()).find((w) => w.id === "ghost")?.title === "ghost2", "a post-delete re-created file revives the widget");

// missing-file reconcile: a DB row whose file vanished gets its file back
widgetsDir!.files.delete("noted-days.json");
await syncWithDisk(root.handle, undefined, undefined, () => {});
assert(widgetsDir!.files.has("noted-days.json"), "deleting a widget file does not delete the widget — the file is recreated");

// ---- export/import round-trip ----
import { createExportPayload, importPayload } from "../src/db/export";

await db.widgets.clear();
await ensureDefaultWidgets();
await saveWidget({ id: "words", type: "counter", title: "words", config: { source: "words-total", format: "{n} words" }, order: 5, enabled: true, updatedAt: 10 });

const exportPayload = await createExportPayload();
assert(exportPayload.widgets.length === 4, "export must include widgets");

const importResult = await importPayload({
  schemaVersion: 1,
  exportedAt: Date.now(),
  days: [],
  panels: [],
  widgets: [
    // older than the live row — must not overwrite
    { id: "words", type: "counter", title: "OLD", config: {}, order: 5, enabled: true, updatedAt: 1 },
    // new custom widget — must import, future stamp clamped
    { id: "phase", type: "text", title: "phase", config: { content: "waxing" }, order: 6, enabled: true, updatedAt: Date.now() + 100_000 },
    // core id with the wrong type — must be skipped
    { id: "calendar", type: "text", title: "calendar", config: { content: "x" }, order: 0, enabled: true, updatedAt: Date.now() + 100_000 },
    // invalid id — must be skipped
    { id: "Bad Id!", type: "text", title: "x", config: { content: "x" }, order: 7, enabled: true, updatedAt: 2 },
  ],
  settings: {},
});
assert(importResult.widgetsImported === 1, "exactly the one valid new widget imports");
const imported = await listWidgets();
assert(imported.find((w) => w.id === "words")?.title === "words", "older import must not overwrite newer widget");
const phase = imported.find((w) => w.id === "phase");
assert(phase !== undefined && phase.updatedAt <= Date.now(), "imported future timestamps are clamped");
assert(imported.find((w) => w.id === "calendar")?.type === "calendar", "core type stays immutable through import");
assert(!imported.some((w) => w.id === "Bad Id!"), "invalid ids are rejected");

// legacy backup: a widget row with no column at all imports as left, not rejected
const legacyImport = await importPayload({
  schemaVersion: 1,
  exportedAt: Date.now(),
  days: [],
  panels: [],
  widgets: [{ id: "legacy-col", type: "text", title: "old", config: { content: "hi" }, order: 8, enabled: true, updatedAt: Date.now() }],
  settings: {},
});
assert(legacyImport.widgetsImported === 1, "a legacy row without column still imports");
assert((await listWidgets()).find((w) => w.id === "legacy-col")?.column === "left", "an imported legacy row lands in the left column");

await db.delete();
console.log("runtime asserts passed");
