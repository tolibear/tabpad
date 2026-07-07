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
assert(widgets.find((w) => w.id === "noted-days")?.title === "days with notes", "noted-days seeds with its renamed heading");
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

// F2: core widgets are now deletable — a core delete tombstones like any row
await deleteWidget("calendar");
assert(!(await listWidgets()).some((w) => w.id === "calendar"), "a core widget can now be deleted");
assert((await readWidgetTombstones()).calendar > 0, "deleting a core widget leaves a tombstone");
// reseed must respect the tombstone: a deleted core stays deleted on reload
await ensureDefaultWidgets();
assert(!(await listWidgets()).some((w) => w.id === "calendar"), "ensureDefaultWidgets must not resurrect a tombstoned core widget");
// re-saving (or re-adding) clears the tombstone; restore calendar for the
// mirror tests further down, which expect the core files to exist
await saveWidget(CORE_WIDGETS.find((c) => c.id === "calendar")!);
assert(!("calendar" in (await readWidgetTombstones())), "re-saving a core id clears its tombstone");

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
  nextTaskMarker,
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

// F7: tri-state to-dos — `- [/]` is in-progress, still counted as open, and
// carries an inProgress flag; `- [x]` stays excluded
const triInput: WidgetDataInput = {
  today: new Date(2026, 6, 6),
  todayKey: "2026-07-06",
  todayText: "- [ ] plain open\n- [/] in the middle\n- [x] finished",
  contentDays: [],
};
const triTasks = openTasks(triInput);
assert(triTasks.length === 2, "in-progress and open both count as open tasks; done is excluded");
assert(triTasks.find((t) => t.text === "plain open")?.inProgress === false, "a [ ] task carries inProgress false");
assert(triTasks.find((t) => t.text === "in the middle")?.inProgress === true, "a [/] task carries inProgress true");
assert(!triTasks.some((t) => t.text === "finished"), "a [x] task is excluded from open tasks");
assert(computeSource("open-tasks", triInput) === 2, "the open-tasks counter counts both open kinds");

// the click cycle: open → in progress → done → open
assert(nextTaskMarker("[ ]") === "[/]", "one click moves an open task to in progress");
assert(nextTaskMarker("[/]") === "[x]", "a second click moves an in-progress task to done");
assert(nextTaskMarker("[x]") === "[ ]", "a third click reopens a done task");
assert(nextTaskMarker("[X]") === "[ ]", "the cycle is case-insensitive on the done marker");

// noted-days excerpt: prefer the first markdown heading among the first 5
// non-empty lines; otherwise the first non-empty line, markdown stripped
const headingInput: WidgetDataInput = {
  today: new Date(2026, 6, 6),
  todayKey: "2026-07-06",
  todayText: "",
  contentDays: [
    day("2026-06-01", "intro line\n## the real title\nmore below"),
    day("2026-06-02", "l1\nl2\nl3\nl4\nl5\n# too late"),
    day("2026-06-03", "just a plain first line\nsecond line"),
    day("2026-06-04", "", "margin only here"),
  ],
};
const headingRows = notedDayRows(headingInput);
assert(headingRows.find((r) => r.date === "2026-06-01")?.excerpt === "the real title", "a heading within the first 5 non-empty lines wins the excerpt");
assert(headingRows.find((r) => r.date === "2026-06-02")?.excerpt === "l1", "a heading after the 5th non-empty line does not win — the first line stands");
assert(headingRows.find((r) => r.date === "2026-06-03")?.excerpt === "just a plain first line", "no heading falls back to the first non-empty line");
assert(headingRows.find((r) => r.date === "2026-06-04")?.excerpt === "margin only here", "a margin-only day keeps its margin excerpt");

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
  eraseMirrorFiles,
  parseWidgetFile,
  removeWidgetMirrorFile,
  serializeWidgetFile,
  syncWithDisk,
  writeFullMirror,
  writeWidgetsMirror,
  type FileSystemDirectoryHandleLike,
  type WidgetFileIssue,
} from "../src/mirror/mirror";
import { getPanel, savePanel, scratchpadPanelId } from "../src/db/panels";
import { eraseAllNotes, firstLineExcerpt } from "../src/db/days";

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

// ---- F6 rename migration ----
// a noted-days row still on the OLD default title migrates to the new one;
// a user-customized title is left untouched
await db.delete();
await db.open();
await db.widgets.put({ id: "noted-days", type: "day-list", title: "noted days", config: {}, order: 1, enabled: true, column: "left", updatedAt: 7 } as never);
await ensureDefaultWidgets();
const migrated = await db.widgets.get("noted-days");
assert(migrated?.title === "days with notes", "the old default 'noted days' title migrates to 'days with notes'");
assert(migrated!.updatedAt > 7, "the rename migration stamps a fresh updatedAt");

await db.delete();
await db.open();
await db.widgets.put({ id: "noted-days", type: "day-list", title: "my days", config: {}, order: 1, enabled: true, column: "left", updatedAt: 7 } as never);
await ensureDefaultWidgets();
const customTitle = await db.widgets.get("noted-days");
assert(customTitle?.title === "my days" && customTitle.updatedAt === 7, "a custom noted-days title survives the rename migration untouched");

// ---- #2/#5: widget teardown removes the paired widget:<id> panel ----
// deleting a scratchpad widget must also drop its widget:<id> content row, or a
// reused id / backup export resurrects the old private text (and it rides in
// every export forever). the core scratchpad's plain "scratchpad" panel is
// spared because its id is never "widget:scratchpad".
await db.delete();
await db.open();
await ensureDefaultWidgets();
await savePanel("scratchpad", "core stays");
await saveWidget({ id: "pad-del", type: "scratchpad", title: "pad", config: {}, order: 5, enabled: true, column: "right", updatedAt: Date.now() });
await savePanel("widget:pad-del", "private content");
assert((await getPanel("widget:pad-del")).content === "private content", "the widget's content is stored under widget:<id>");
await deleteWidget("pad-del");
assert((await getPanel("widget:pad-del")).content === "", "deleteWidget removes the paired widget:<id> panel row");
await deleteWidget("scratchpad");
assert((await getPanel("scratchpad")).content === "core stays", "deleting the core scratchpad widget spares its plain 'scratchpad' panel");
// a non-scratchpad widget has no paired panel — deleting it is a harmless no-op
await saveWidget({ id: "count-del", type: "counter", title: "c", config: {}, order: 6, enabled: true, column: "left", updatedAt: Date.now() });
await deleteWidget("count-del");
assert(!(await listWidgets()).some((w) => w.id === "count-del"), "a non-scratchpad widget still deletes cleanly");

// ---- F4: multiple independent scratchpads ----
await db.delete();
await db.open();
await ensureDefaultWidgets();

// the classic scratchpad keeps the "scratchpad" panel id; every other
// scratchpad widget owns a widget:<id> panel — content never collides
assert(scratchpadPanelId("scratchpad") === "scratchpad", "the core scratchpad keeps the classic panel id");
assert(scratchpadPanelId("notes-2") === "widget:notes-2", "a non-core scratchpad uses a widget:<id> panel id");

await savePanel("scratchpad", "CORE scratch");
await saveWidget({ id: "notes-2", type: "scratchpad", title: "second pad", config: {}, order: 5, enabled: true, column: "right", updatedAt: Date.now() });
await savePanel(scratchpadPanelId("notes-2"), "SECOND scratch");
assert((await getPanel("scratchpad")).content === "CORE scratch", "saving a second scratchpad never touches panels('scratchpad')");
assert((await getPanel("widget:notes-2")).content === "SECOND scratch", "second scratchpad content is stored under widget:<id>");

// mirror: widgets/notes-2.md holds the widget's content, widgets/notes-2.json
// its config; root scratchpad.md holds only the CORE content
const sp = makeFakeDir();
await writeFullMirror(sp.handle);
const spWidgets = sp.dirs.get("widgets");
assert(spWidgets?.files.get("notes-2.md")?.text === "SECOND scratch", "mirror writes the widget scratchpad content to widgets/<id>.md");
assert(spWidgets?.files.has("notes-2.json"), "the widget's config json is written alongside its .md");
assert(sp.files.get("scratchpad.md")?.text === "CORE scratch", "root scratchpad.md holds the core scratchpad, untouched by the widget");

// a disk edit of widgets/notes-2.md syncs into the widget:<id> panel, and
// leaves the core scratchpad alone
spWidgets!.files.set("notes-2.md", { text: "edited on disk", lastModified: Date.now() + 1_000 });
await syncWithDisk(sp.handle, undefined, undefined, () => {});
assert((await getPanel("widget:notes-2")).content === "edited on disk", "a disk edit of widgets/<id>.md imports into the widget panel");
assert((await getPanel("scratchpad")).content === "CORE scratch", "editing a widget .md never changes the core scratchpad");

// deleting the widget trash-copies then removes BOTH its .json and .md; root
// scratchpad.md is never touched
await removeWidgetMirrorFile(sp.handle, "notes-2");
assert(!spWidgets!.files.has("notes-2.json") && !spWidgets!.files.has("notes-2.md"), "delete removes both the widget json and md");
const spTrash = [...sp.dirs.get(".tabpad-trash")?.files.keys() ?? []];
assert(spTrash.some((n) => n.includes("notes-2.json")) && spTrash.some((n) => n.includes("notes-2.md")), "both widget files are trash-copied on delete");
assert(sp.files.get("scratchpad.md")?.text === "CORE scratch", "deleting a scratchpad widget never touches root scratchpad.md");

// a tombstoned widget's stale .md cannot resurrect anything — sync cleans it up
await deleteWidget("notes-2");
spWidgets!.files.set("notes-2.md", { text: "stale ghost text", lastModified: Date.now() - 5_000 });
await syncWithDisk(sp.handle, undefined, undefined, () => {});
assert(!spWidgets!.files.has("notes-2.md"), "a stale .md for a tombstoned scratchpad is cleaned up, not imported");

// PanelRow string ids round-trip export/import
await db.panels.clear();
await savePanel("scratchpad", "core text");
await savePanel("widget:pad-x", "widget text");
const panelPayload = await createExportPayload();
assert(panelPayload.panels.some((p) => p.id === "widget:pad-x"), "export includes widget:<id> panels");
await db.panels.clear();
const panelImport = await importPayload({
  schemaVersion: 1,
  exportedAt: Date.now(),
  days: [],
  panels: panelPayload.panels.map((p) => ({ ...p, updatedAt: Date.now() })),
  widgets: [],
  settings: {},
});
assert(panelImport.panelsImported === 2, "both panel rows import");
assert((await getPanel("widget:pad-x")).content === "widget text", "a widget:<id> panel round-trips through export/import");
assert((await getPanel("scratchpad")).content === "core text", "the classic scratchpad panel still round-trips");

// ---- #1: erase clears widgets/*.md content (keeps widgets/*.json config) ----
// a surviving content file would re-import erased private text on the next sync,
// so "erase all notes" must descend into widgets/ and clear the .md files too.
await db.delete();
await db.open();
await ensureDefaultWidgets();
await saveWidget({ id: "erase-pad", type: "scratchpad", title: "pad", config: {}, order: 7, enabled: true, column: "right", updatedAt: Date.now() });
await savePanel("widget:erase-pad", "erase this secret");
const erDir = makeFakeDir();
await writeFullMirror(erDir.handle);
const erWidgets = erDir.dirs.get("widgets");
assert(erWidgets?.files.get("erase-pad.md")?.text === "erase this secret", "widget content is mirrored to widgets/<id>.md");
assert(erWidgets?.files.has("erase-pad.json"), "widget config is mirrored to widgets/<id>.json");
await eraseAllNotes(); // clears db.panels (the widget:<id> content row)
await eraseMirrorFiles(erDir.handle);
assert(!erWidgets!.files.has("erase-pad.md"), "erase removes the widget content .md");
assert(erWidgets!.files.has("erase-pad.json"), "erase keeps the widget config .json");
assert([...(erDir.dirs.get(".tabpad-trash")?.files.keys() ?? [])].some((n) => n.includes("erase-pad.md")), "erased widget content is trash-copied first");
// after erase + a reload sync, the erased content must NOT resurrect
await syncWithDisk(erDir.handle, undefined, undefined, () => {});
assert((await getPanel("widget:erase-pad")).content === "", "a custom scratchpad widget's content stays erased after reload");

await db.delete();
console.log("runtime asserts passed");
