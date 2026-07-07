# Widget Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the hardcoded left rail (calendar + noted days) into a declarative widget system: registered, toggleable, reorderable widgets stored in the local DB, managed from settings, and mirrored as `widgets/*.json` files that agents can author.

**Architecture:** A new Dexie `widgets` table holds `WidgetRow` records (core widgets `calendar` and `noted-days` are seeded rows). A pure-data registry maps the five widget types to labels, default configs, sanitizers, and form-field descriptors; React renderer components live separately so the registry is testable in Node. The rail maps enabled rows through a `WidgetShell`. Mirror/sync extends the existing last-write-wins-per-file machinery to a `widgets/` directory. No arbitrary code anywhere — widgets are data only (CSP `script-src 'self'` and Chrome Web Store remote-code policy are hard constraints).

**Tech Stack:** React 18, TypeScript, Dexie 4, Vite, esbuild+fake-indexeddb verify scripts (repo's existing `verify-mN` pattern — there is no vitest/jest; tests are `scripts/verify-widgets-runtime.ts` assertions run via `npm run verify:widgets`).

**Spec:** `docs/superpowers/specs/2026-07-06-widget-rail-design.md` — read it first.

## Global Constraints

- No new dependencies. No `eval`, no dynamic script loading, no remote fetches (manifest CSP is `script-src 'self'; object-src 'self'; img-src 'self' data:`).
- All UI copy is lowercase (matches the whole app: "noted days", "settings", "erase all notes").
- Never rename the Dexie database ("tabpad") or existing tables; the `widgets` table is added via `this.version(2).stores(...)` — version 1 stays untouched.
- Widget ids: `/^[a-z0-9][a-z0-9-]{0,39}$/`. Reserved core ids: `calendar`, `noted-days`.
- Widget types (exactly five): `calendar`, `day-list`, `counter`, `task-rollup`, `text`.
- Timestamps compared for sync must be clamped to `Date.now()` (see existing `writeDayMirror` comments — future stamps must never win merges forever).
- Match existing code style: 2-space indent, double quotes, explanatory comments only where behavior is subtle, components + helpers colocated per file.
- Every task ends with `npm run typecheck` and `npm run verify:widgets` green before commit.

---

### Task 1: DB schema, widget store, verify harness

**Files:**
- Modify: `src/db/db.ts` (add `WidgetType`, `WidgetRow`, `widgets` table, version 2)
- Create: `src/db/widgets.ts`
- Create: `scripts/verify-widgets.mjs`
- Create: `scripts/verify-widgets-runtime.ts`
- Modify: `package.json` (add `verify:widgets` script)

**Interfaces:**
- Consumes: existing `db` Dexie instance.
- Produces (later tasks rely on these exact names):
  - `db.ts`: `type WidgetType = "calendar" | "day-list" | "counter" | "task-rollup" | "text"`; `interface WidgetRow { id: string; type: WidgetType; title: string; config: Record<string, unknown>; order: number; enabled: boolean; updatedAt: number }`; `db.widgets: Table<WidgetRow, string>`
  - `widgets.ts`: `CORE_WIDGETS: WidgetRow[]`, `WIDGET_ID_PATTERN: RegExp`, `isCoreWidget(id: string): boolean`, `ensureDefaultWidgets(): Promise<void>`, `listWidgets(): Promise<WidgetRow[]>`, `saveWidget(row: WidgetRow): Promise<void>`, `deleteWidget(id: string): Promise<void>`

- [ ] **Step 1: Create the verify harness**

`scripts/verify-widgets.mjs` (same shape as `verify-m2.mjs`; static asserts get appended by later tasks):

```js
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

console.log("widgets verification passed");
```

Add to `package.json` scripts, after `"verify:m7"`:

```json
"verify:widgets": "node scripts/verify-widgets.mjs",
```

- [ ] **Step 2: Write the failing runtime test**

`scripts/verify-widgets-runtime.ts`:

```ts
import "fake-indexeddb/auto";
import { db } from "../src/db/db";
import {
  CORE_WIDGETS,
  deleteWidget,
  ensureDefaultWidgets,
  isCoreWidget,
  listWidgets,
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

assert(WIDGET_ID_PATTERN.test("my-widget-2"), "slug ids must pass the pattern");
assert(!WIDGET_ID_PATTERN.test("My Widget") && !WIDGET_ID_PATTERN.test("-x") && !WIDGET_ID_PATTERN.test(""), "non-slugs must fail the pattern");

await db.delete();
console.log("runtime asserts passed");
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run verify:widgets`
Expected: FAIL — cannot resolve `../src/db/widgets` (module does not exist yet).

- [ ] **Step 4: Add types and table to `src/db/db.ts`**

After the `PanelRow` interface, add:

```ts
export type WidgetType = "calendar" | "day-list" | "counter" | "task-rollup" | "text";

export interface WidgetRow {
  id: string;
  type: WidgetType;
  title: string;
  config: Record<string, unknown>;
  order: number;
  enabled: boolean;
  updatedAt: number;
}
```

In the `TabPadDB` class, add the table declaration next to the others:

```ts
widgets!: Table<WidgetRow, string>;
```

And in the constructor, after the existing `this.version(1).stores({...})` call (do not touch version 1):

```ts
this.version(2).stores({
  widgets: "id, order",
});
```

- [ ] **Step 5: Create `src/db/widgets.ts`**

```ts
import { db, type WidgetRow } from "./db";

// the two widgets every install starts with — the rail's historical layout.
// updatedAt 0 means any mirrored widgets/ file wins the first sync merge, so
// a folder from another machine restores its widget setup cleanly
export const CORE_WIDGETS: WidgetRow[] = [
  { id: "calendar", type: "calendar", title: "", config: {}, order: 0, enabled: true, updatedAt: 0 },
  { id: "noted-days", type: "day-list", title: "noted days", config: {}, order: 1, enabled: true, updatedAt: 0 },
];

// slug ids double as mirror filenames (widgets/<id>.json)
export const WIDGET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function isCoreWidget(id: string): boolean {
  return CORE_WIDGETS.some((core) => core.id === id);
}

// seed core widgets that have NO row at all — first run, or a core widget
// added by an app update. never touches rows the user has edited or disabled
export async function ensureDefaultWidgets(): Promise<void> {
  await db.transaction("rw", db.widgets, async () => {
    for (const core of CORE_WIDGETS) {
      const existing = await db.widgets.get(core.id);
      if (!existing) await db.widgets.put({ ...core });
    }
  });
}

export async function listWidgets(): Promise<WidgetRow[]> {
  const rows = await db.widgets.toArray();
  return rows.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export async function saveWidget(row: WidgetRow): Promise<void> {
  await db.widgets.put(row);
}

export async function deleteWidget(id: string): Promise<void> {
  if (isCoreWidget(id)) throw new Error(`core widget "${id}" cannot be deleted`);
  await db.widgets.delete(id);
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm run verify:widgets && npm run typecheck`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add src/db/db.ts src/db/widgets.ts scripts/verify-widgets.mjs scripts/verify-widgets-runtime.ts package.json
git commit -m "Widget store: widgets table (db v2), core-widget seeding, verify harness"
```

---

### Task 2: Data sources

**Files:**
- Create: `src/widgets/sources.ts`
- Modify: `scripts/verify-widgets-runtime.ts` (append asserts)

**Interfaces:**
- Consumes: `DayRow` from `../db/db`, `firstLineExcerpt`/`hasDayContent` from `../db/days`, `addDays`/`dateKey` from `../lib/dates`.
- Produces:
  - `interface WidgetDataInput { today: Date; todayKey: string; todayText: string; contentDays: DayRow[] }`
  - `type SourceId = "noted-days" | "streak" | "open-tasks" | "words-today" | "words-total"`
  - `sourceOptions: Array<{ value: SourceId; label: string }>`, `isSourceId(value: unknown): value is SourceId`
  - `contentDateKeys(input): Set<string>`, `notedDayRows(input, limit?, order?): Array<{ date: string; excerpt: string }>`, `streakCount(input): number`, `openTasks(input, days?, limit?): Array<{ date: string; text: string }>`, `computeSource(source: SourceId, input): number`

- [ ] **Step 1: Append failing asserts to `scripts/verify-widgets-runtime.ts`**

Insert BEFORE the final `await db.delete();` line:

```ts
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
```

Note: top-level `import` in the middle of the file is fine — esbuild hoists module imports; keep the helper `day()` and asserts where shown so db-store asserts above still run first.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run verify:widgets`
Expected: FAIL — cannot resolve `../src/widgets/sources`.

- [ ] **Step 3: Create `src/widgets/sources.ts`**

```ts
import type { DayRow } from "../db/db";
import { firstLineExcerpt, hasDayContent } from "../db/days";
import { addDays, dateKey } from "../lib/dates";

// everything widgets may read — data the app already holds in memory.
// widgets never touch the database; read-only by construction
export interface WidgetDataInput {
  today: Date;
  todayKey: string;
  todayText: string;
  contentDays: DayRow[];
}

export type SourceId = "noted-days" | "streak" | "open-tasks" | "words-today" | "words-total";

export const sourceOptions: Array<{ value: SourceId; label: string }> = [
  { value: "noted-days", label: "days with notes" },
  { value: "streak", label: "consecutive noted days" },
  { value: "open-tasks", label: "open to-dos" },
  { value: "words-today", label: "words today" },
  { value: "words-total", label: "words all time" },
];

export function isSourceId(value: unknown): value is SourceId {
  return sourceOptions.some((option) => option.value === value);
}

// per-day text with today's saved copy replaced by the live editor text —
// the same today-override the rail has always done
function collectDays(input: WidgetDataInput): Map<string, { main: string; margin: string }> {
  const byDate = new Map<string, { main: string; margin: string }>();
  for (const row of input.contentDays) {
    if (hasDayContent(row.main, row.margin)) byDate.set(row.date, { main: row.main, margin: row.margin });
  }
  if (hasDayContent(input.todayText)) {
    byDate.set(input.todayKey, { main: input.todayText, margin: byDate.get(input.todayKey)?.margin ?? "" });
  }
  return byDate;
}

export function contentDateKeys(input: WidgetDataInput): Set<string> {
  return new Set(collectDays(input).keys());
}

export function notedDayRows(
  input: WidgetDataInput,
  limit = 50,
  order: "newest" | "oldest" = "newest",
): Array<{ date: string; excerpt: string }> {
  const rows = Array.from(collectDays(input).entries()).map(([date, { main, margin }]) => ({
    date,
    excerpt: firstLineExcerpt(main || margin) || (date === input.todayKey ? "today" : "margin note"),
  }));
  rows.sort((a, b) => (order === "newest" ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)));
  return rows.slice(0, limit);
}

// consecutive noted days ending today — or yesterday, so an unwritten
// morning doesn't read as a broken streak
export function streakCount(input: WidgetDataInput): number {
  const keys = contentDateKeys(input);
  let cursor = keys.has(input.todayKey) ? input.today : addDays(input.today, -1);
  let count = 0;
  while (keys.has(dateKey(cursor))) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}

const OPEN_TASK = /^\s*- \[ \]\s+(.+)$/;

// open `- [ ]` lines, newest day first. days=0 means no window; future days
// always pass the window (planned to-dos should surface)
export function openTasks(
  input: WidgetDataInput,
  days = 0,
  limit = Number.POSITIVE_INFINITY,
): Array<{ date: string; text: string }> {
  const floor = days > 0 ? dateKey(addDays(input.today, -(days - 1))) : "";
  const tasks: Array<{ date: string; text: string }> = [];
  const entries = Array.from(collectDays(input).entries()).sort((a, b) => b[0].localeCompare(a[0]));
  for (const [date, { main, margin }] of entries) {
    if (date < floor) continue;
    for (const line of `${main}\n${margin}`.split(/\r?\n/)) {
      if (tasks.length >= limit) return tasks;
      const match = OPEN_TASK.exec(line);
      if (match) tasks.push({ date, text: match[1].trim() });
    }
  }
  return tasks.slice(0, limit);
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function computeSource(source: SourceId, input: WidgetDataInput): number {
  const days = collectDays(input);
  switch (source) {
    case "noted-days":
      return days.size;
    case "streak":
      return streakCount(input);
    case "open-tasks":
      return openTasks(input).length;
    case "words-today": {
      const today = days.get(input.todayKey);
      return today ? wordCount(`${today.main} ${today.margin}`) : 0;
    }
    case "words-total":
      return Array.from(days.values()).reduce((sum, { main, margin }) => sum + wordCount(`${main} ${margin}`), 0);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run verify:widgets && npm run typecheck`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add src/widgets/sources.ts scripts/verify-widgets-runtime.ts
git commit -m "Widget data sources: noted days, streak, open tasks, word counts — pure functions over in-memory data"
```

---

### Task 3: Registry, config sanitizers, problem detection

**Files:**
- Create: `src/widgets/registry.ts`
- Modify: `scripts/verify-widgets-runtime.ts` (append asserts)

**Interfaces:**
- Consumes: `WidgetRow`, `WidgetType` from `../db/db`; `isSourceId`, `sourceOptions`, `SourceId` from `./sources`.
- Produces (exact names later tasks use):
  - `widgetTypes: WidgetType[]`, `isWidgetType(value: unknown): value is WidgetType`
  - `interface WidgetField { key: string; label: string; kind: "text" | "number" | "select"; options?: Array<{ value: string; label: string }>; min?: number; max?: number; placeholder?: string }`
  - `interface WidgetDefinition { type: WidgetType; label: string; description: string; defaultConfig: Record<string, unknown>; fields: WidgetField[] }`
  - `widgetRegistry: Record<WidgetType, WidgetDefinition>`
  - Config types + sanitizers: `DayListConfig`/`sanitizeDayListConfig(raw)`, `CounterConfig`/`sanitizeCounterConfig(raw)`, `TaskRollupConfig`/`sanitizeTaskRollupConfig(raw)`, `TextConfig`/`sanitizeTextConfig(raw)`, and `sanitizeWidgetConfig(type: WidgetType, raw: Record<string, unknown>): Record<string, unknown>`
  - `widgetProblem(row: Pick<WidgetRow, "type" | "config">): string | null` — null means renderable

- [ ] **Step 1: Append failing asserts to the runtime file** (before the final `await db.delete();`)

```ts
// ---- registry + sanitizers ----
import {
  isWidgetType,
  sanitizeCounterConfig,
  sanitizeDayListConfig,
  sanitizeTaskRollupConfig,
  sanitizeTextConfig,
  sanitizeWidgetConfig,
  widgetProblem,
  widgetRegistry,
  widgetTypes,
} from "../src/widgets/registry";

assert(widgetTypes.length === 5 && isWidgetType("task-rollup") && !isWidgetType("iframe"), "exactly five declarative types");
assert(Object.keys(widgetRegistry).length === 5, "registry covers every type");
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

assert(sanitizeWidgetConfig("calendar", { junk: 1 }).junk === undefined, "calendar config is always empty");
assert((sanitizeWidgetConfig("counter", { source: "open-tasks" }) as { source: string }).source === "open-tasks", "sanitizeWidgetConfig dispatches per type");

assert(widgetProblem({ type: "counter", config: {} }) === null, "counter with defaults renders");
assert(widgetProblem({ type: "iframe" as never, config: {} })?.includes("unknown widget type"), "unknown type is a named problem");
assert(widgetProblem({ type: "text", config: { content: "  " } })?.includes("no content"), "empty text widget is a named problem");
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run verify:widgets`
Expected: FAIL — cannot resolve `../src/widgets/registry`.

- [ ] **Step 3: Create `src/widgets/registry.ts`**

Pure data + functions — no React imports, so the verify runtime can bundle it for Node.

```ts
import type { WidgetRow, WidgetType } from "../db/db";
import { isSourceId, sourceOptions, type SourceId } from "./sources";

// what the settings form needs to render one config field
export interface WidgetField {
  key: string;
  label: string;
  kind: "text" | "number" | "select";
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  placeholder?: string;
}

export interface WidgetDefinition {
  type: WidgetType;
  label: string;
  description: string;
  defaultConfig: Record<string, unknown>;
  fields: WidgetField[];
}

export const widgetTypes: WidgetType[] = ["calendar", "day-list", "counter", "task-rollup", "text"];

export function isWidgetType(value: unknown): value is WidgetType {
  return typeof value === "string" && (widgetTypes as string[]).includes(value);
}

export const widgetRegistry: Record<WidgetType, WidgetDefinition> = {
  calendar: {
    type: "calendar",
    label: "calendar",
    description: "mini month calendar — noted days marked, click to jump",
    defaultConfig: {},
    fields: [],
  },
  "day-list": {
    type: "day-list",
    label: "day list",
    description: "days that have notes, with a first-line excerpt",
    defaultConfig: { limit: 50, order: "newest" },
    fields: [
      { key: "limit", label: "how many", kind: "number", min: 1, max: 200 },
      {
        key: "order",
        label: "order",
        kind: "select",
        options: [
          { value: "newest", label: "newest first" },
          { value: "oldest", label: "oldest first" },
        ],
      },
    ],
  },
  counter: {
    type: "counter",
    label: "counter",
    description: "one number — streak, open to-dos, word counts",
    defaultConfig: { source: "streak", format: "{n}" },
    fields: [
      { key: "source", label: "count", kind: "select", options: sourceOptions },
      { key: "format", label: "format", kind: "text", placeholder: "{n} day streak" },
    ],
  },
  "task-rollup": {
    type: "task-rollup",
    label: "to-do rollup",
    description: "open to-dos from recent days, click to jump",
    defaultConfig: { days: 14, limit: 20 },
    fields: [
      { key: "days", label: "look back (days)", kind: "number", min: 1, max: 90 },
      { key: "limit", label: "max items", kind: "number", min: 1, max: 100 },
    ],
  },
  text: {
    type: "text",
    label: "text",
    description: "a fixed note pinned in the sidebar",
    defaultConfig: { content: "" },
    fields: [{ key: "content", label: "text", kind: "text", placeholder: "shown as written" }],
  },
};

export interface DayListConfig {
  limit: number;
  order: "newest" | "oldest";
}

export interface CounterConfig {
  source: SourceId;
  format: string;
}

export interface TaskRollupConfig {
  days: number;
  limit: number;
}

export interface TextConfig {
  content: string;
}

// out-of-range values fall back silently, matching how settings sanitize
const clampNumber = (value: unknown, min: number, max: number, fallback: number): number => {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed)
    ? Math.min(max, Math.max(min, Math.round(parsed)))
    : fallback;
};

export function sanitizeDayListConfig(raw: Record<string, unknown>): DayListConfig {
  return {
    limit: clampNumber(raw.limit, 1, 200, 50),
    order: raw.order === "oldest" ? "oldest" : "newest",
  };
}

export function sanitizeCounterConfig(raw: Record<string, unknown>): CounterConfig {
  return {
    source: isSourceId(raw.source) ? raw.source : "streak",
    format: typeof raw.format === "string" && raw.format.trim() !== "" ? raw.format : "{n}",
  };
}

export function sanitizeTaskRollupConfig(raw: Record<string, unknown>): TaskRollupConfig {
  return {
    days: clampNumber(raw.days, 1, 90, 14),
    limit: clampNumber(raw.limit, 1, 100, 20),
  };
}

export function sanitizeTextConfig(raw: Record<string, unknown>): TextConfig {
  return { content: typeof raw.content === "string" ? raw.content : "" };
}

export function sanitizeWidgetConfig(type: WidgetType, raw: Record<string, unknown>): Record<string, unknown> {
  switch (type) {
    case "calendar":
      return {};
    case "day-list":
      return { ...sanitizeDayListConfig(raw) };
    case "counter":
      return { ...sanitizeCounterConfig(raw) };
    case "task-rollup":
      return { ...sanitizeTaskRollupConfig(raw) };
    case "text":
      return { ...sanitizeTextConfig(raw) };
  }
}

// a widget the rail cannot render gets an inline error card naming the
// problem — never a crash, never silence (authors need the feedback)
export function widgetProblem(row: Pick<WidgetRow, "type" | "config">): string | null {
  if (!isWidgetType(row.type)) return `unknown widget type "${String(row.type)}" — one of: ${widgetTypes.join(", ")}`;
  if (row.type === "text" && sanitizeTextConfig(row.config).content.trim() === "") return "text widget has no content";
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run verify:widgets && npm run typecheck`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add src/widgets/registry.ts scripts/verify-widgets-runtime.ts
git commit -m "Widget registry: five declarative types with sanitized configs and form-field descriptors"
```

---

### Task 4: Renderer components

**Files:**
- Create: `src/widgets/WidgetShell.tsx` (shell + body switch + error card)
- Create: `src/widgets/CalendarWidget.tsx` (MiniCalendar moved from Rail)
- Create: `src/widgets/DayListWidget.tsx` (NotedDays generalized)
- Create: `src/widgets/SimpleWidgets.tsx` (counter, task-rollup, text)

**Interfaces:**
- Consumes: registry + sources from Tasks 2–3; `scrambleText` from `../lib/scramble`; `dateFromKey`, `shortDate`, `shortWeekday`, `monthLabel`, `calendarDays`, `dateKey` from `../lib/dates`; `WidgetRow` from `../db/db`.
- Produces:
  - `interface WidgetContext { data: WidgetDataInput; weekStartsOn: 0 | 1; currentTopKey: string; privacyMode: boolean; onJumpToDate: (date: Date) => void }` (exported from `WidgetShell.tsx`)
  - `WidgetShell({ row, context }: { row: WidgetRow; context: WidgetContext })` — the only component Rail imports.

Note: this task is components only — nothing renders them yet. The gate is `npm run typecheck`.

- [ ] **Step 1: Create `src/widgets/CalendarWidget.tsx`**

Move `MiniCalendar` (and its private helpers `addMonths`, `weekdayInitials`) out of `src/rail/Rail.tsx` nearly verbatim; the differences: props collapse to `{ context }`, content keys come from `contentDateKeys(context.data)`, and the outer element loses the `calendar-shell` section (the shell provides the section now).

```tsx
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { calendarDays, monthLabel } from "../lib/dates";
import { contentDateKeys } from "./sources";
import type { WidgetContext } from "./WidgetShell";

export function CalendarWidget({ context }: { context: WidgetContext }) {
  const { today } = context.data;
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  // a pinned new tab lives across month rollovers — snap the calendar to the
  // new month when today moves into one (manual browsing is untouched
  // otherwise)
  const todayMonthKey = `${today.getFullYear()}-${today.getMonth()}`;
  useEffect(() => {
    setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayMonthKey]);
  const contentKeys = useMemo(() => contentDateKeys(context.data), [context.data]);
  const days = useMemo(
    () => calendarDays(visibleMonth, today, contentKeys, context.weekStartsOn),
    [contentKeys, today, visibleMonth, context.weekStartsOn],
  );
  const weekdays = useMemo(() => weekdayInitials(context.weekStartsOn), [context.weekStartsOn]);

  return (
    <>
      <div className="month-row">
        <button
          className="icon-button ghost"
          type="button"
          aria-label="previous month"
          onClick={() => setVisibleMonth((date) => addMonths(date, -1))}
        >
          <ChevronLeft aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>
        <button
          className="month-label"
          type="button"
          onClick={() => setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1))}
        >
          {monthLabel(visibleMonth)}
        </button>
        <button
          className="icon-button ghost"
          type="button"
          aria-label="next month"
          onClick={() => setVisibleMonth((date) => addMonths(date, 1))}
        >
          <ChevronRight aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>
      </div>
      <div className="weekday-grid" aria-hidden="true">
        {weekdays.map((weekday, index) => (
          <span key={`${weekday}-${index}`}>{weekday}</span>
        ))}
      </div>
      <div className="date-grid">
        {days.map((day) => (
          <button
            className={[
              "date-cell",
              day.inMonth ? "" : "outside",
              day.isToday ? "today" : "",
              day.hasContent ? "noted" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            key={day.key}
            type="button"
            aria-label={day.date.toDateString()}
            onClick={() => context.onJumpToDate(day.date)}
          >
            <span>{day.day}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function addMonths(date: Date, offset: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

function weekdayInitials(weekStartsOn: 0 | 1): string[] {
  const sundayFirst = ["s", "m", "t", "w", "t", "f", "s"];
  if (weekStartsOn === 0) return sundayFirst;

  return [...sundayFirst.slice(1), sundayFirst[0]];
}
```

- [ ] **Step 2: Create `src/widgets/DayListWidget.tsx`**

NotedDays generalized: rows come from `notedDayRows` with the sanitized config; heading is gone (shell owns it).

```tsx
import type { WidgetRow } from "../db/db";
import { dateFromKey, shortDate, shortWeekday } from "../lib/dates";
import { scrambleText } from "../lib/scramble";
import { sanitizeDayListConfig } from "./registry";
import { notedDayRows } from "./sources";
import type { WidgetContext } from "./WidgetShell";

export function DayListWidget({ row, context }: { row: WidgetRow; context: WidgetContext }) {
  const config = sanitizeDayListConfig(row.config);
  const rows = notedDayRows(context.data, config.limit, config.order);

  if (!rows.length) return <p className="empty-rail">no notes yet</p>;

  return (
    <div className="noted-list">
      {rows.map((entry) => {
        const date = dateFromKey(entry.date);

        return (
          <button
            className={entry.date === context.currentTopKey ? "noted-row active" : "noted-row"}
            key={entry.date}
            type="button"
            onClick={() => {
              if (date) context.onJumpToDate(date);
            }}
          >
            <span className="noted-date">
              {date ? shortDate(date) : entry.date} {date ? `· ${shortWeekday(date)}` : ""}
            </span>
            <span className="noted-excerpt">{context.privacyMode ? scrambleText(entry.excerpt) : entry.excerpt}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Create `src/widgets/SimpleWidgets.tsx`**

```tsx
import type { WidgetRow } from "../db/db";
import { dateFromKey, shortDate } from "../lib/dates";
import { scrambleText } from "../lib/scramble";
import { sanitizeCounterConfig, sanitizeTaskRollupConfig, sanitizeTextConfig } from "./registry";
import { computeSource, openTasks } from "./sources";
import type { WidgetContext } from "./WidgetShell";

export function CounterWidget({ row, context }: { row: WidgetRow; context: WidgetContext }) {
  const config = sanitizeCounterConfig(row.config);
  const value = computeSource(config.source, context.data);
  return <p className="widget-counter">{config.format.replaceAll("{n}", String(value))}</p>;
}

export function TaskRollupWidget({ row, context }: { row: WidgetRow; context: WidgetContext }) {
  const config = sanitizeTaskRollupConfig(row.config);
  const tasks = openTasks(context.data, config.days, config.limit);

  if (!tasks.length) return <p className="empty-rail">no open to-dos</p>;

  return (
    <div className="noted-list">
      {tasks.map((task, index) => {
        const date = dateFromKey(task.date);
        return (
          <button
            className="noted-row"
            key={`${task.date}-${index}`}
            type="button"
            onClick={() => {
              if (date) context.onJumpToDate(date);
            }}
          >
            <span className="noted-date">{date ? shortDate(date) : task.date}</span>
            <span className="noted-excerpt">{context.privacyMode ? scrambleText(task.text) : task.text}</span>
          </button>
        );
      })}
    </div>
  );
}

export function TextWidget({ row, context }: { row: WidgetRow; context: WidgetContext }) {
  const config = sanitizeTextConfig(row.config);
  return <p className="widget-text">{context.privacyMode ? scrambleText(config.content) : config.content}</p>;
}
```

- [ ] **Step 4: Create `src/widgets/WidgetShell.tsx`**

```tsx
import type { WidgetRow } from "../db/db";
import { widgetProblem, widgetRegistry } from "./registry";
import type { WidgetDataInput } from "./sources";
import { CalendarWidget } from "./CalendarWidget";
import { DayListWidget } from "./DayListWidget";
import { CounterWidget, TaskRollupWidget, TextWidget } from "./SimpleWidgets";

// everything a widget may see or do — read-only data plus jump-to-date
export interface WidgetContext {
  data: WidgetDataInput;
  weekStartsOn: 0 | 1;
  currentTopKey: string;
  privacyMode: boolean;
  onJumpToDate: (date: Date) => void;
}

interface WidgetProps {
  row: WidgetRow;
  context: WidgetContext;
}

export function WidgetShell({ row, context }: WidgetProps) {
  const problem = widgetProblem(row);
  const label = row.title || widgetRegistry[row.type]?.label || row.type;

  return (
    <section className={`rail-widget widget-${row.type}`} aria-label={label}>
      {row.title ? <h2>{row.title}</h2> : null}
      {problem ? <p className="widget-error">{`"${row.id}" can't render: ${problem}`}</p> : <WidgetBody row={row} context={context} />}
    </section>
  );
}

function WidgetBody({ row, context }: WidgetProps) {
  switch (row.type) {
    case "calendar":
      return <CalendarWidget context={context} />;
    case "day-list":
      return <DayListWidget row={row} context={context} />;
    case "counter":
      return <CounterWidget row={row} context={context} />;
    case "task-rollup":
      return <TaskRollupWidget row={row} context={context} />;
    case "text":
      return <TextWidget row={row} context={context} />;
    default:
      return null;
  }
}
```

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm run verify:widgets`
Expected: both PASS (components are not wired yet; Rail still compiles with its own copies).

```bash
git add src/widgets/WidgetShell.tsx src/widgets/CalendarWidget.tsx src/widgets/DayListWidget.tsx src/widgets/SimpleWidgets.tsx
git commit -m "Widget renderers: shell with error card, calendar and day-list moved from Rail, counter/rollup/text"
```

---

### Task 5: Rail refactor + app wiring + CSS

**Files:**
- Modify: `src/rail/Rail.tsx` (delete MiniCalendar/NotedDays/helpers; map widgets)
- Modify: `src/app.tsx` (widget state, seeding, load)
- Modify: `src/styles/app.css` (widget stack + new classes; retire `.calendar-shell`/`.noted-days` section rules)
- Modify: `scripts/verify-widgets.mjs` (static asserts)

**Interfaces:**
- Consumes: `WidgetShell`, `WidgetContext` from Task 4; `ensureDefaultWidgets`, `listWidgets` from Task 1.
- Produces: `RailProps` gains `widgets: WidgetRow[]` and `widgetFileIssues: Array<{ file: string; error: string }>` (issues stay an empty array until Task 7 wires sync); app.tsx exposes `refreshWidgets(): Promise<void>` (a `useCallback`) that later tasks reuse.

Behavior change to know about: the whole widget stack scrolls as one region now (previously the calendar was pinned and only noted-days scrolled). That is the honest generalization for N widgets; with the default two-widget layout the difference is barely visible because the calendar sits at the scroll top.

- [ ] **Step 1: Add static asserts to `scripts/verify-widgets.mjs`** (after the runtime import, before the final `console.log`)

```js
const rail = readFileSync("src/rail/Rail.tsx", "utf8");
assert(!rail.includes("MiniCalendar"), "Rail must not hardcode MiniCalendar");
assert(!rail.includes("function NotedDays"), "Rail must not hardcode NotedDays");
assert(rail.includes("WidgetShell"), "Rail must render widgets through WidgetShell");

const appSource = readFileSync("src/app.tsx", "utf8");
assert(appSource.includes("ensureDefaultWidgets"), "app must seed core widgets on load");
```

Run: `npm run verify:widgets` — expected FAIL ("Rail must not hardcode MiniCalendar").

- [ ] **Step 2: Rewrite `src/rail/Rail.tsx`**

Keep the brand mark block and `rail-bottom` exactly as they are. Replace the imports, props, and middle section:

```tsx
import { Link2Off, Lock, LockOpen, Settings } from "lucide-react";
import { useMemo } from "react";
import type { DayRow, WidgetRow } from "../db/db";
import { dateKey } from "../lib/dates";
import type { MirrorStatus } from "../mirror/mirror";
import { WidgetShell, type WidgetContext } from "../widgets/WidgetShell";

export interface WidgetFileIssue {
  file: string;
  error: string;
}

interface RailProps {
  today: Date;
  todayText: string;
  contentDays: DayRow[];
  widgets: WidgetRow[];
  widgetFileIssues: WidgetFileIssue[];
  weekStartsOn: 0 | 1;
  currentTopKey: string;
  mirrorStatus: MirrorStatus;
  mirrorName: string;
  privacyMode: boolean;
  onJumpToDate: (date: Date) => void;
  onOpenSettings: () => void;
  onReconnectMirror: () => void;
  onTogglePrivacy: () => void;
}

export function Rail({
  today,
  todayText,
  contentDays,
  widgets,
  widgetFileIssues,
  weekStartsOn,
  currentTopKey,
  mirrorStatus,
  mirrorName,
  privacyMode,
  onJumpToDate,
  onOpenSettings,
  onReconnectMirror,
  onTogglePrivacy,
}: RailProps) {
  const needsReconnect = mirrorStatus === "reconnect" || mirrorStatus === "error";
  const needsSetup = mirrorStatus === "off";
  const context: WidgetContext = useMemo(
    () => ({
      data: { today, todayKey: dateKey(today), todayText, contentDays },
      weekStartsOn,
      currentTopKey,
      privacyMode,
      onJumpToDate,
    }),
    [contentDays, currentTopKey, onJumpToDate, privacyMode, today, todayText, weekStartsOn],
  );

  return (
    <aside className="rail" aria-label="Tab Pad navigation">
      {/* ...existing rail-mark block, unchanged... */}
      <div className="rail-widgets">
        {widgets
          .filter((row) => row.enabled)
          .map((row) => (
            <WidgetShell key={row.id} row={row} context={context} />
          ))}
        {widgetFileIssues.map((issue) => (
          <section className="rail-widget" key={issue.file}>
            <p className="widget-error">{`${issue.file}: ${issue.error}`}</p>
          </section>
        ))}
      </div>
      {/* ...existing rail-bottom block, unchanged... */}
    </aside>
  );
}
```

Delete `MiniCalendarProps`, `MiniCalendar`, `NotedDaysProps`, `NotedDays`, `contentKeySet`, `notedRows`, `addMonths`, `weekdayInitials` and their now-unused imports (`ChevronLeft`, `ChevronRight`, `useEffect`/`useState`, `firstLineExcerpt`, `hasDayContent`, `calendarDays`, `dateFromKey`, `monthLabel`, `shortDate`, `shortWeekday`, `scrambleText`). `mirrorName` stays in props (unused there before this change too — leave as is).

- [ ] **Step 3: Wire app.tsx**

Add imports:

```ts
import { ensureDefaultWidgets, listWidgets } from "./db/widgets";
import type { WidgetRow } from "./db/db";  // extend the existing type-import line
import type { WidgetFileIssue } from "./rail/Rail";
```

Add state next to `contentDays` (around `src/app.tsx:107`):

```ts
const [widgets, setWidgets] = useState<WidgetRow[]>([]);
const [widgetFileIssues, setWidgetFileIssues] = useState<WidgetFileIssue[]>([]);
```

Add a refresher next to `refreshContentDays`:

```ts
const refreshWidgets = useCallback(async () => {
  setWidgets(await listWidgets());
}, []);
```

In `loadDocuments`, right after `seedOnboardingIfFirstRun`, add:

```ts
await ensureDefaultWidgets();
```

and include widgets in the parallel load — extend the existing `Promise.all`:

```ts
const [day, scratchpad, settings, rows, widgetRows] = await Promise.all([
  getDay(todayKey),
  getPanel("scratchpad"),
  getSettings(),
  listContentDays(),
  listWidgets(),
]);
```

then next to `setContentDays(rows)` add `setWidgets(widgetRows);`.

Pass to Rail (the `<Rail ...>` JSX):

```tsx
widgets={widgets}
widgetFileIssues={widgetFileIssues}
```

(`setWidgetFileIssues` is intentionally unused until Task 7 — add `void widgetFileIssues;`-style suppression ONLY if typecheck complains; it won't, because it is passed to Rail. `setWidgetFileIssues` unused will error under noUnusedLocals — to keep this task green, don't add the state setter yet: declare it as `const [widgetFileIssues] = useState<WidgetFileIssue[]>([]);` and convert to the full pair in Task 7.)

- [ ] **Step 4: CSS**

In `src/styles/app.css`:

Replace the `.calendar-shell` rule (lines ~97–100) with:

```css
/* the widget stack is the rail's one scrolling region — widgets stack
   inside it, the brand mark above and buttons below stay put */
.rail-widgets {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 20px;
  overflow-y: auto;
  scrollbar-width: none;
}

.rail-widgets::-webkit-scrollbar {
  display: none;
}

.rail-widget {
  flex-shrink: 0;
}

.rail-widget h2 {
  margin: 0 0 10px;
  color: var(--faint);
  font-size: 11px;
  font-weight: 650;
  text-transform: uppercase;
}

.widget-calendar {
  border-bottom: 1px solid var(--line);
  padding-bottom: 17px;
}

.widget-counter {
  margin: 0;
  color: var(--ink);
  font-size: 20px;
  font-weight: 640;
}

.widget-text {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.widget-error {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
  border: 1px dashed var(--line);
  border-radius: 7px;
  padding: 8px;
}
```

Delete the now-dead `.noted-days`, `.noted-days::-webkit-scrollbar`, and `.noted-days h2` rules (lines ~216–234). Keep `.noted-list`, `.noted-row`, `.noted-date`, `.noted-excerpt`, `.empty-rail` — the widget bodies still use them. Check the two remaining references: `grep -n "noted-days\|calendar-shell" src/styles/app.css` must come back empty; `.app-shell.privacy-mode .noted-excerpt` (line ~1334) stays.

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run verify:widgets && npm run build`
Expected: all PASS.

Then visually smoke it: `npm run dev`, open the shown URL — the rail must look unchanged (calendar on top, noted days under it), calendar navigation and day-jumping must work, privacy toggle must scramble excerpts.

- [ ] **Step 6: Commit**

```bash
git add src/rail/Rail.tsx src/app.tsx src/styles/app.css scripts/verify-widgets.mjs
git commit -m "Rail renders from the widget registry — calendar and noted days become seeded widget rows"
```

---

### Task 6: Settings UI + CRUD + broadcast

**Files:**
- Create: `src/settings/WidgetSettings.tsx`
- Modify: `src/settings/SettingsOverlay.tsx` (new "sidebar" section + props)
- Modify: `src/db/broadcast.ts` (add `widgets` message)
- Modify: `src/app.tsx` (CRUD handlers, broadcast post/listen)
- Modify: `src/styles/app.css` (form styles)
- Modify: `scripts/verify-widgets.mjs` (static asserts)

**Interfaces:**
- Consumes: `widgetRegistry`, `widgetTypes`, `sanitizeWidgetConfig`, `WidgetField` from registry; `isCoreWidget`, `WIDGET_ID_PATTERN`, `saveWidget`, `deleteWidget`, `listWidgets` from the store.
- Produces:
  - broadcast: `{ type: "widgets"; key: "all"; updatedAt: number }` added to `TabPadChange`
  - `WidgetSettings` props: `{ widgets: WidgetRow[]; onToggle(id, enabled): void; onMove(id, direction: -1 | 1): void; onDelete(id): void; onSave(row: WidgetRow): void }`
  - app.tsx handlers with those signatures, all posting the `widgets` broadcast. Task 7 replaces the body of `handleWidgetDelete` to also remove the mirror file and adds mirror queueing to `applyWidgetChange` — write them as shown so that seam exists.

- [ ] **Step 1: Static asserts first** (append to `verify-widgets.mjs`)

```js
const broadcastSource = readFileSync("src/db/broadcast.ts", "utf8");
assert(broadcastSource.includes('type: "widgets"'), "broadcast union must carry widget changes");

const overlay = readFileSync("src/settings/SettingsOverlay.tsx", "utf8");
assert(overlay.includes("WidgetSettings"), "settings must render the widget manager");
```

Run: `npm run verify:widgets` — expected FAIL.

- [ ] **Step 2: Extend `src/db/broadcast.ts`**

Add to the `TabPadChange` union, after the `settings` member:

```ts
| { type: "widgets"; key: "all"; updatedAt: number }
```

- [ ] **Step 3: Create `src/settings/WidgetSettings.tsx`**

```tsx
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { WidgetRow, WidgetType } from "../db/db";
import { isCoreWidget, WIDGET_ID_PATTERN } from "../db/widgets";
import { widgetRegistry, widgetTypes, type WidgetField } from "../widgets/registry";

interface WidgetSettingsProps {
  widgets: WidgetRow[];
  onToggle: (id: string, enabled: boolean) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onDelete: (id: string) => void;
  onSave: (row: WidgetRow) => void;
}

interface Draft {
  id: string | null; // null = adding
  type: WidgetType;
  title: string;
  config: Record<string, unknown>;
}

export function WidgetSettings({ widgets, onToggle, onMove, onDelete, onSave }: WidgetSettingsProps) {
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  const startAdd = (type: WidgetType) => {
    setPicking(false);
    setDraft({ id: null, type, title: widgetRegistry[type].label, config: { ...widgetRegistry[type].defaultConfig } });
  };

  const submit = () => {
    if (!draft) return;
    const existing = draft.id ? widgets.find((w) => w.id === draft.id) : undefined;
    onSave({
      id: draft.id ?? uniqueWidgetId(draft.title, draft.type, widgets),
      type: draft.type,
      title: draft.title.trim(),
      config: draft.config,
      order: existing?.order ?? (widgets.length ? Math.max(...widgets.map((w) => w.order)) + 1 : 0),
      enabled: existing?.enabled ?? true,
      updatedAt: Date.now(),
    });
    setDraft(null);
  };

  return (
    <section className="settings-section" aria-label="sidebar">
      <h3>sidebar</h3>
      <div className="mode-list">
        {widgets.map((row, index) => (
          <div className="widget-row" key={row.id}>
            <button
              className={row.enabled ? "mode-choice selected widget-choice" : "mode-choice widget-choice"}
              type="button"
              role="switch"
              aria-checked={row.enabled}
              onClick={() => onToggle(row.id, !row.enabled)}
            >
              <span className="mode-row">
                {row.title || widgetRegistry[row.type]?.label || row.type}
                <span className={row.enabled ? "mode-switch on" : "mode-switch"} aria-hidden="true" />
              </span>
              <small>
                {widgetRegistry[row.type]?.label ?? row.type}
                {isCoreWidget(row.id) ? " · built-in" : ""}
              </small>
            </button>
            <div className="widget-row-actions">
              <button
                className="icon-button ghost"
                type="button"
                aria-label={`move ${row.id} up`}
                disabled={index === 0}
                onClick={() => onMove(row.id, -1)}
              >
                <ChevronUp aria-hidden="true" size={14} strokeWidth={1.8} />
              </button>
              <button
                className="icon-button ghost"
                type="button"
                aria-label={`move ${row.id} down`}
                disabled={index === widgets.length - 1}
                onClick={() => onMove(row.id, 1)}
              >
                <ChevronDown aria-hidden="true" size={14} strokeWidth={1.8} />
              </button>
              <button
                className="icon-button ghost"
                type="button"
                aria-label={`edit ${row.id}`}
                onClick={() => setDraft({ id: row.id, type: row.type, title: row.title, config: { ...row.config } })}
              >
                <Pencil aria-hidden="true" size={14} strokeWidth={1.8} />
              </button>
              {!isCoreWidget(row.id) ? (
                <button
                  className="icon-button ghost"
                  type="button"
                  aria-label={`delete ${row.id}`}
                  onClick={() => onDelete(row.id)}
                >
                  <Trash2 aria-hidden="true" size={14} strokeWidth={1.8} />
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {draft ? (
        <div className="widget-form">
          <label className="widget-field">
            <span>title</span>
            <input
              className="widget-field-input"
              type="text"
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </label>
          {widgetRegistry[draft.type].fields.map((field) => (
            <label className="widget-field" key={field.key}>
              <span>{field.label}</span>
              <FieldInput
                field={field}
                value={draft.config[field.key]}
                onChange={(value) => setDraft({ ...draft, config: { ...draft.config, [field.key]: value } })}
              />
            </label>
          ))}
          <div className="widget-form-actions">
            <button className="data-button" type="button" onClick={submit}>
              <span>{draft.id ? "save widget" : "add widget"}</span>
            </button>
            <button className="data-button" type="button" onClick={() => setDraft(null)}>
              <span>cancel</span>
            </button>
          </div>
        </div>
      ) : picking ? (
        <div className="widget-type-list">
          {widgetTypes.map((type) => (
            <button className="mode-choice" key={type} type="button" onClick={() => startAdd(type)}>
              <span className="mode-row">{widgetRegistry[type].label}</span>
              <small>{widgetRegistry[type].description}</small>
            </button>
          ))}
          <button className="data-button" type="button" onClick={() => setPicking(false)}>
            <span>cancel</span>
          </button>
        </div>
      ) : (
        <button className="data-button" type="button" onClick={() => setPicking(true)}>
          <Plus aria-hidden="true" size={14} strokeWidth={1.8} />
          <span>add widget</span>
        </button>
      )}
      <p>widgets also live as files in your notes folder (widgets/*.json) — agents can add and edit them.</p>
    </section>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: WidgetField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (field.kind === "select") {
    return (
      <select className="widget-field-input" value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}>
        {field.options?.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.kind === "number") {
    return (
      <input
        className="widget-field-input"
        type="number"
        min={field.min}
        max={field.max}
        value={typeof value === "number" ? value : ""}
        onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
      />
    );
  }
  return (
    <input
      className="widget-field-input"
      type="text"
      placeholder={field.placeholder}
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

// slugified title, falling back to the type; suffixed until unique
function uniqueWidgetId(title: string, type: WidgetType, widgets: WidgetRow[]): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const slug = WIDGET_ID_PATTERN.test(base) ? base : type;
  let candidate = slug;
  let suffix = 2;
  while (widgets.some((w) => w.id === candidate)) candidate = `${slug}-${suffix++}`;
  return candidate;
}
```

- [ ] **Step 4: Render it in `SettingsOverlay.tsx`**

Add props to `SettingsOverlayProps` and destructure them:

```ts
widgets: WidgetRow[];
onWidgetToggle: (id: string, enabled: boolean) => void;
onWidgetMove: (id: string, direction: -1 | 1) => void;
onWidgetDelete: (id: string) => void;
onWidgetSave: (row: WidgetRow) => void;
```

(import `WidgetRow` from `../db/db` and `WidgetSettings` from `./WidgetSettings`.) Insert after the "layout" section:

```tsx
<WidgetSettings
  widgets={widgets}
  onToggle={onWidgetToggle}
  onMove={onWidgetMove}
  onDelete={onWidgetDelete}
  onSave={onWidgetSave}
/>
```

- [ ] **Step 5: app.tsx handlers**

Extend imports: `saveWidget`, `deleteWidget` from `./db/widgets`; `sanitizeWidgetConfig` from `./widgets/registry`.

Add after `refreshWidgets` (Task 5):

```ts
// every widget change: persist, refresh this tab, tell other tabs.
// (task 7 adds mirror-file queueing here.)
const applyWidgetChange = useCallback(
  async (change: () => Promise<void>) => {
    await change();
    await refreshWidgets();
    channelRef.current?.post({ type: "widgets", key: "all", updatedAt: Date.now() });
  },
  [refreshWidgets],
);

const handleWidgetSave = useCallback(
  (row: WidgetRow) => {
    void applyWidgetChange(() =>
      saveWidget({ ...row, config: sanitizeWidgetConfig(row.type, row.config), updatedAt: Date.now() }),
    );
  },
  [applyWidgetChange],
);

const handleWidgetToggle = useCallback(
  (id: string, enabled: boolean) => {
    void applyWidgetChange(async () => {
      const row = (await listWidgets()).find((w) => w.id === id);
      if (row) await saveWidget({ ...row, enabled, updatedAt: Date.now() });
    });
  },
  [applyWidgetChange],
);

const handleWidgetMove = useCallback(
  (id: string, direction: -1 | 1) => {
    void applyWidgetChange(async () => {
      const rows = await listWidgets();
      const index = rows.findIndex((w) => w.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= rows.length) return;
      const reordered = [...rows];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      const now = Date.now();
      // rewrite order as clean indexes so duplicates (imports, file sync) heal
      for (const [position, row] of reordered.entries()) {
        if (row.order !== position) await saveWidget({ ...row, order: position, updatedAt: now });
      }
    });
  },
  [applyWidgetChange],
);

const handleWidgetDelete = useCallback(
  (id: string) => {
    void applyWidgetChange(async () => {
      await deleteWidget(id);
    });
  },
  [applyWidgetChange],
);
```

In the broadcast listener effect (after the `settings` branch):

```ts
if (message.type === "widgets") {
  void refreshWidgets();
}
```

(add `refreshWidgets` to that effect's dependency array.)

Pass to `<SettingsOverlay ...>`:

```tsx
widgets={widgets}
onWidgetToggle={handleWidgetToggle}
onWidgetMove={handleWidgetMove}
onWidgetDelete={handleWidgetDelete}
onWidgetSave={handleWidgetSave}
```

- [ ] **Step 6: CSS** (append near the settings styles)

```css
.widget-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
}

.widget-row-actions {
  display: flex;
  gap: 2px;
}

.widget-row-actions .icon-button {
  width: 24px;
  height: 24px;
}

.widget-row-actions .icon-button:disabled {
  opacity: 0.35;
  cursor: default;
}

.widget-form,
.widget-type-list {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}

.widget-field {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  color: var(--muted);
  font-size: 12px;
}

.widget-field-input {
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 12px;
  padding: 6px 8px;
}

.widget-form-actions {
  display: flex;
  gap: 8px;
}
```

- [ ] **Step 7: Verify and commit**

Run: `npm run typecheck && npm run verify:widgets && npm run build`
Expected: all PASS.

Manual smoke (`npm run dev`): settings → sidebar section lists calendar + noted days; toggle hides/shows in the rail live; reorder flips them; add a counter ("streak", format "{n} day streak") and see it render; edit it; delete it; open a second tab and confirm the change propagates (broadcast).

```bash
git add src/settings/WidgetSettings.tsx src/settings/SettingsOverlay.tsx src/db/broadcast.ts src/app.tsx src/styles/app.css scripts/verify-widgets.mjs
git commit -m "Settings sidebar section: toggle, reorder, add, edit, delete widgets; widgets broadcast"
```

---

### Task 7: Mirror files + two-way sync + agent docs

**Files:**
- Modify: `src/mirror/mirror.ts` (serialize/parse, `writeWidgetsMirror`, `removeWidgetMirrorFile`, sync pass, `writeFullMirror`, `writeAgentFiles`, `agentsGuide`)
- Modify: `src/app.tsx` (issues state, mirror queueing, sync wiring)
- Modify: `src/settings/SettingsOverlay.tsx` (one line in `buildAgentPrompt`)
- Modify: `scripts/verify-widgets-runtime.ts` (sync asserts with a fake directory handle)
- Modify: `scripts/verify-widgets.mjs` (static asserts)

**Interfaces:**
- Consumes: `isWidgetType`, `widgetTypes` from registry; `CORE_WIDGETS`, `isCoreWidget` from the widget store; existing `readDiskFile`, `writeTextFile`, `writeTrashCopy` internals of mirror.ts.
- Produces:
  - `interface WidgetFileIssue { file: string; error: string }` (moves to mirror.ts; Rail re-exports or imports from there — put the canonical type in `mirror.ts` and change `Rail.tsx` to `import type { WidgetFileIssue } from "../mirror/mirror";`, deleting its local copy)
  - `serializeWidgetFile(row: WidgetRow): string`
  - `parseWidgetFile(id: string, text: string): { row: Omit<WidgetRow, "updatedAt"> } | { error: string }`
  - `writeWidgetsMirror(handle, widgets: WidgetRow[]): Promise<void>`
  - `removeWidgetMirrorFile(handle, id: string): Promise<void>`
  - `syncWithDisk(handle, mtimes?, getSkip?, onWidgetIssues?: (issues: WidgetFileIssue[]) => void): Promise<number>` — 4th parameter added

- [ ] **Step 1: Append failing sync asserts to the runtime file** (before the final `await db.delete();`)

```ts
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
```

Also append these static asserts to `verify-widgets.mjs`:

```js
const mirrorSource = readFileSync("src/mirror/mirror.ts", "utf8");
assert(mirrorSource.includes("Sidebar widgets"), "AGENTS.md guide must document widgets");
assert(mirrorSource.includes("widgets/<slug>.json"), "tabpad.json manifest must name the widget files");
```

Run: `npm run verify:widgets` — expected FAIL (missing exports).

- [ ] **Step 2: Implement in `src/mirror/mirror.ts`**

Imports to add at the top:

```ts
import { db, type DayRow, type PanelRow, type WidgetRow } from "../db/db";  // extend existing line
import { CORE_WIDGETS } from "../db/widgets";
import { isWidgetType, widgetTypes } from "../widgets/registry";
```

Add near the other constants:

```ts
const WIDGETS_DIR = "widgets";
const WIDGET_FILE = /^([a-z0-9][a-z0-9-]{0,39})\.json$/;

export interface WidgetFileIssue {
  file: string;
  error: string;
}
```

Serialize/parse (id lives in the filename, not the body):

```ts
export function serializeWidgetFile(row: WidgetRow): string {
  return `${JSON.stringify(
    { type: row.type, title: row.title, enabled: row.enabled, order: row.order, config: row.config },
    null,
    2,
  )}\n`;
}

export function parseWidgetFile(id: string, text: string): { row: Omit<WidgetRow, "updatedAt"> } | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: "not valid JSON" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { error: "not a JSON object" };
  const raw = value as Record<string, unknown>;
  if (!isWidgetType(raw.type)) {
    return { error: `unknown type "${String(raw.type)}" — one of: ${widgetTypes.join(", ")}` };
  }
  const core = CORE_WIDGETS.find((widget) => widget.id === id);
  if (core && raw.type !== core.type) {
    return { error: `built-in widget "${id}" must keep type "${core.type}"` };
  }
  return {
    row: {
      id,
      type: raw.type,
      title: typeof raw.title === "string" ? raw.title : "",
      config: typeof raw.config === "object" && raw.config !== null && !Array.isArray(raw.config)
        ? (raw.config as Record<string, unknown>)
        : {},
      order: Number.isFinite(raw.order) ? (raw.order as number) : 99,
      enabled: raw.enabled !== false,
    },
  };
}
```

Mirror write with the same freshness guard as `writeDayMirror`:

```ts
export async function writeWidgetsMirror(handle: FileSystemDirectoryHandleLike, widgets: WidgetRow[]): Promise<void> {
  let dir: FileSystemDirectoryHandleLike | null = null;
  try {
    dir = await handle.getDirectoryHandle(WIDGETS_DIR);
  } catch {
    dir = null;
  }
  for (const row of widgets) {
    const name = `${row.id}.json`;
    const content = serializeWidgetFile(row);
    const disk = dir ? await readDiskFile(dir, name) : null;
    // same freshness guard as notes: never clobber a newer external edit —
    // sync imports it instead. unlike notes, absent files are always created
    // (even for untouched defaults) so the folder documents the format
    if (
      disk
        ? disk.text !== content &&
          (disk.lastModified > Date.now() + 2000 || disk.lastModified <= Math.min(row.updatedAt, Date.now()))
        : true
    ) {
      await writeTextFile(handle, [WIDGETS_DIR, name], content);
    }
  }
}

export async function removeWidgetMirrorFile(handle: FileSystemDirectoryHandleLike, id: string): Promise<void> {
  try {
    const dir = await handle.getDirectoryHandle(WIDGETS_DIR);
    const name = `${id}.json`;
    const disk = await readDiskFile(dir, name);
    if (disk && disk.text.trim() !== "") await writeTrashCopy(handle, [WIDGETS_DIR, name], disk.text);
    await dir.removeEntry?.(name);
  } catch {
    // no folder or no file — nothing to remove
  }
}
```

Extend `writeFullMirror` — change its first line to include widgets and add the call at the end:

```ts
const [days, scratchpad, widgets] = await Promise.all([db.days.toArray(), getPanel("scratchpad"), db.widgets.toArray()]);
// ...existing day + panel writes unchanged...
await writeWidgetsMirror(handle, widgets);
```

Extend `syncWithDisk`: signature becomes

```ts
export async function syncWithDisk(
  handle: FileSystemDirectoryHandleLike,
  mtimes?: Map<string, number>,
  getSkip?: () => SyncSkip,
  onWidgetIssues?: (issues: WidgetFileIssue[]) => void,
): Promise<number> {
```

Declare `const widgetIssues: WidgetFileIssue[] = [];` next to `let imported = 0;`, call `onWidgetIssues?.(widgetIssues);` immediately before the final `return imported;`, and add a directory branch after the existing `margins` branch:

```ts
} else if (entry.kind === "directory" && entry.name === WIDGETS_DIR) {
  const widgetsDir = await handle.getDirectoryHandle(WIDGETS_DIR);
  if (!widgetsDir.values) continue;
  for await (const widgetEntry of widgetsDir.values()) {
    if (widgetEntry.kind !== "file") continue;
    const match = WIDGET_FILE.exec(widgetEntry.name);
    if (!match) continue;
    const cacheKey = `widgets/${widgetEntry.name}`;
    const disk = await readIfChanged(widgetsDir, widgetEntry.name, cacheKey);
    if (!disk) continue;
    const parsed = parseWidgetFile(match[1], disk.text);
    if ("error" in parsed) {
      // report but never import or overwrite — the author may be mid-edit.
      // no mtime cache either, so the issue re-reports until the file is fixed
      widgetIssues.push({ file: cacheKey, error: parsed.error });
      continue;
    }
    let push: WidgetRow | null = null;
    await db.transaction("rw", db.widgets, async () => {
      const row = await db.widgets.get(match[1]);
      if (row && serializeWidgetFile(row) === disk.text) return;
      const now = Date.now();
      const trusted = disk.lastModified <= now + 2000;
      const diskStamp = Math.min(disk.lastModified, now);
      if (!row || (trusted && diskStamp > Math.min(row.updatedAt, now))) {
        await db.widgets.put({ ...parsed.row, updatedAt: diskStamp });
        imported += 1;
      } else {
        push = row;
      }
    });
    if (push) await writeTextFile(handle, [WIDGETS_DIR, `${match[1]}.json`], serializeWidgetFile(push));
    mtimes?.set(cacheKey, disk.lastModified);
  }
}
```

Extend `writeAgentFiles` manifest — inside the `manifest` object add to `surfaces`:

```ts
widgets: true,
```

and to `files`:

```ts
widget: "widgets/<slug>.json",
```

Extend `agentsGuide` — add before the `## Editing` section:

```
## Sidebar widgets

\`widgets/<slug>.json\` — each file is one widget in the app's left sidebar
(slug: lowercase letters, digits, hyphens). Create or edit these files to add
or change widgets; changes appear live like notes.

\`\`\`json
{
  "type": "counter",
  "title": "writing streak",
  "enabled": true,
  "order": 2,
  "config": { "source": "streak", "format": "{n} day streak" }
}
\`\`\`

Types and their config:
- \`calendar\` — mini month calendar. config: {}
- \`day-list\` — noted days with excerpts. config: { "limit": 1-200, "order": "newest"|"oldest" }
- \`counter\` — one number. config: { "source": "noted-days"|"streak"|"open-tasks"|"words-today"|"words-total", "format": "text with {n}" }
- \`task-rollup\` — open \`- [ ]\` lines from recent days. config: { "days": 1-90, "limit": 1-100 }
- \`text\` — fixed text. config: { "content": "..." }

Rules:
- \`calendar\` and \`noted-days\` are built-in: retitle, reorder, or disable
  them, but keep their type.
- To hide a widget set \`"enabled": false\` — deleting the file does NOT
  remove it (the app recreates the file).
- Lower \`order\` = higher in the sidebar. Widgets are data only — no code.
```

- [ ] **Step 3: Wire app.tsx**

Change the Task 5 state line to the full pair:

```ts
const [widgetFileIssues, setWidgetFileIssues] = useState<WidgetFileIssue[]>([]);
```

with `import type { WidgetFileIssue } from "./mirror/mirror";` (and update `Rail.tsx` to import the type from `../mirror/mirror` instead of declaring it, keeping the prop). Add imports `writeWidgetsMirror`, `removeWidgetMirrorFile` to the existing mirror import block.

Add an issues applier that keeps identity stable (the 3-second poll must not re-render the rail every pass):

```ts
const applyWidgetIssues = useCallback((issues: WidgetFileIssue[]) => {
  setWidgetFileIssues((current) =>
    current.length === issues.length &&
    current.every((issue, index) => issue.file === issues[index].file && issue.error === issues[index].error)
      ? current
      : issues,
  );
}, []);
```

Pass it in BOTH `syncWithDisk` call sites — `loadDocuments` and `syncFolderNow`:

```ts
await syncWithDisk(handle, syncMtimes.current, () => ({
  day: focusedDayRef.current,
  margin: focusedMarginRef.current,
  scratchpad: focusedPanelRef.current === "scratchpad",
}), applyWidgetIssues);
```

(`loadDocuments` and `syncFolderNow` must add `applyWidgetIssues` to their dependency arrays.) In `syncFolderNow`, inside `if (imported > 0) { ... }`, add `await refreshWidgets();` (and `refreshWidgets` to the deps).

Mirror queueing — add after `queueMirrorPanel`:

```ts
// widget changes are tiny and rare — one debounced full rewrite of widgets/
const mirrorWidgetsTimer = useRef(0);
const flushMirrorWidgets = useCallback(() => {
  if (mirrorStatus !== "connected" || erasingRef.current) return Promise.resolve();
  const run = async () => {
    if (erasingRef.current) return;
    const handle = mirrorHandleRef.current;
    if (!handle) return;
    try {
      await writeWidgetsMirror(handle, await listWidgets());
      syncFailures.current = 0;
    } catch (error) {
      console.warn("Tab Pad widget mirror failed", error);
      if (isMirrorPermissionError(error)) setMirrorStatus("reconnect");
      else if ((syncFailures.current += 1) >= 3) setMirrorStatus("error");
    }
  };
  const result = syncChainRef.current.then(run, run);
  syncChainRef.current = result.catch(() => undefined);
  return result;
}, [mirrorStatus]);

const queueMirrorWidgets = useCallback(() => {
  if (mirrorStatus !== "connected" || erasingRef.current) return;
  window.clearTimeout(mirrorWidgetsTimer.current);
  mirrorWidgetsTimer.current = window.setTimeout(() => {
    void flushMirrorWidgets();
  }, 800);
}, [flushMirrorWidgets, mirrorStatus]);
```

Wire it into `applyWidgetChange` (Task 6's comment marks the seam) — after the broadcast post add `queueMirrorWidgets();` and add it to the deps. In the broadcast listener's `widgets` branch, also queue (the folder-holding tab mirrors other tabs' edits, like days do):

```ts
if (message.type === "widgets") {
  void refreshWidgets().then(() => queueMirrorWidgetsRef.current());
}
```

with a ref next to `queueMirrorDayRef`:

```ts
const queueMirrorWidgetsRef = useRef<() => void>(() => {});
```

kept current by:

```ts
useEffect(() => {
  queueMirrorWidgetsRef.current = queueMirrorWidgets;
}, [queueMirrorWidgets]);
```

Replace `handleWidgetDelete`'s body to also remove the file:

```ts
const handleWidgetDelete = useCallback(
  (id: string) => {
    void applyWidgetChange(async () => {
      await deleteWidget(id);
      const handle = mirrorHandleRef.current;
      if (handle && mirrorStatus === "connected") {
        await removeWidgetMirrorFile(handle, id).catch((error) =>
          console.warn("Tab Pad widget file removal failed", error),
        );
      }
    });
  },
  [applyWidgetChange, mirrorStatus],
);
```

- [ ] **Step 4: One line in `buildAgentPrompt`** (`src/settings/SettingsOverlay.tsx`)

In the skill's `## Layout` list, after the margins line, add:

```
- \`widgets/<slug>.json\` — sidebar widgets (counters, to-do rollups, text notes — see AGENTS.md for the format)
```

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm run verify:widgets && npm run build`
Expected: all PASS.

Manual smoke (`npm run dev` with a connected folder): add a widget → `widgets/<id>.json` appears; edit the file externally (change the title) → rail updates within ~3s; write garbage into the file → error card names it; fix the file → card clears; delete the widget in settings → file goes, trash copy exists.

```bash
git add src/mirror/mirror.ts src/app.tsx src/rail/Rail.tsx src/settings/SettingsOverlay.tsx scripts/verify-widgets-runtime.ts scripts/verify-widgets.mjs
git commit -m "Widgets mirror to widgets/*.json with two-way sync; agent contract documents the format"
```

---

### Task 8: Export/import

**Files:**
- Modify: `src/db/export.ts`
- Modify: `src/app.tsx` (import result message)
- Modify: `scripts/verify-widgets-runtime.ts` (append asserts)

**Interfaces:**
- Consumes: `WidgetRow` from db, `isWidgetType`, `sanitizeWidgetConfig` from registry, `WIDGET_ID_PATTERN`, `CORE_WIDGETS` from the widget store.
- Produces: `TabPadExport` gains `widgets: WidgetRow[]`; `importPayload` returns `{ daysImported, panelsImported, widgetsImported }`.

- [ ] **Step 1: Append failing asserts** (before the final `await db.delete();`)

```ts
// ---- export/import round-trip ----
import { createExportPayload, importPayload } from "../src/db/export";

await db.widgets.clear();
await ensureDefaultWidgets();
await saveWidget({ id: "words", type: "counter", title: "words", config: { source: "words-total", format: "{n} words" }, order: 5, enabled: true, updatedAt: 10 });

const exportPayload = await createExportPayload();
assert(exportPayload.widgets.length === 3, "export must include widgets");

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
```

Note the runtime file already imports `createExportPayload`/`importPayload`? It does not (only verify-m2 does) — this import line is new; if a duplicate import error occurs, merge with any existing import from `../src/db/export`.

Run: `npm run verify:widgets` — expected FAIL (`exportPayload.widgets` undefined / `widgetsImported` missing).

- [ ] **Step 2: Implement in `src/db/export.ts`**

Add imports:

```ts
import { db, defaultSettings, type DayRow, type PanelRow, type Settings, type WidgetRow } from "./db";
import { CORE_WIDGETS, WIDGET_ID_PATTERN } from "./widgets";
import { isWidgetType, sanitizeWidgetConfig } from "../widgets/registry";
```

`TabPadExport` gains `widgets: WidgetRow[];`. `createExportPayload`:

```ts
const [days, panels, widgets, settings] = await Promise.all([
  db.days.toArray(),
  db.panels.toArray(),
  db.widgets.toArray(),
  getSettings(),
]);
```

and include `widgets` in the returned object. In `parsePayload`'s return, add:

```ts
widgets: Array.isArray(payload.widgets)
  ? payload.widgets.filter(isWidgetRow).map((widget) => ({
      ...widget,
      config: sanitizeWidgetConfig(widget.type, widget.config),
      updatedAt: Math.min(widget.updatedAt, Date.now()),
    }))
  : [],
```

In `importPayload`, add `db.widgets` to the transaction table list, add `let widgetsImported = 0;`, and after the panels loop:

```ts
for (const widget of parsed.widgets) {
  const existing = await db.widgets.get(widget.id);
  if (!existing || widget.updatedAt >= existing.updatedAt) {
    await db.widgets.put(widget);
    widgetsImported += 1;
  }
}
```

Return `{ daysImported, panelsImported, widgetsImported }`. Add the guard function next to `isPanelRow`:

```ts
function isWidgetRow(value: unknown): value is WidgetRow {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    !WIDGET_ID_PATTERN.test(value.id) ||
    !isWidgetType(value.type) ||
    typeof value.title !== "string" ||
    !isObject(value.config) ||
    !Number.isFinite(value.order) ||
    typeof value.enabled !== "boolean" ||
    !Number.isFinite(value.updatedAt)
  ) {
    return false;
  }
  // a core id must keep its core type — otherwise the rail's built-ins mutate
  const core = CORE_WIDGETS.find((widget) => widget.id === value.id);
  return !core || core.type === value.type;
}
```

- [ ] **Step 3: Surface the count in app.tsx**

In `importJson`, extend the success message and refresh widgets:

```ts
await refreshWidgets();
setDataMessage(`imported ${result.daysImported} days, ${result.panelsImported} panels, ${result.widgetsImported} widgets`);
```

(`loadDocuments` already reloads widgets, but `importJson` calls it — the explicit `refreshWidgets` is unnecessary; skip it and only change the message.)

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck && npm run verify:widgets && npm run build`
Expected: all PASS. Also run the existing suites that touch export: `npm run verify:m2 && npm run verify:m4` (they assert on export/import behavior; the extra `widgets` key must not break them — their payloads simply lack widgets, which parses to `[]`).

```bash
git add src/db/export.ts src/app.tsx scripts/verify-widgets-runtime.ts
git commit -m "Export/import carries widgets — merged by updatedAt, ids validated, core types immutable"
```

---

### Task 9: Final gate

**Files:**
- No new code. Possibly small fixes.

- [ ] **Step 1: Full verification**

Run each; all must pass:

```bash
npm run typecheck
npm run verify:widgets
npm run verify:m1 && npm run verify:m2 && npm run verify:m3 && npm run verify:m4 && npm run verify:m5 && npm run verify:m6 && npm run verify:m7
npm run build
```

- [ ] **Step 2: Manual acceptance pass** (`npm run dev`, and ideally the built extension via `dist/` loaded unpacked)

1. Fresh profile: rail shows calendar + noted days exactly as before.
2. Settings → sidebar: toggle noted days off/on; move calendar below it; add a counter, a to-do rollup, a text widget; edit each; delete a custom one. Core widgets show no delete button.
3. Second tab open at the same time reflects every change within a beat.
4. Connect a notes folder: `widgets/*.json` appear; `AGENTS.md` documents widgets; `tabpad.json` lists the surface.
5. Edit a widget file externally → live update. Break the JSON → error card; fix → card clears.
6. Privacy mode scrambles day-list excerpts, rollup tasks, and text widgets.
7. Focus mode still hides the rail; narrow window still stacks it.
8. Export → JSON contains widgets; erase-all leaves widgets; import restores.

- [ ] **Step 3: Commit any fixes, then update the spec status line**

Change the spec's `**Status:**` line to `implemented`. Commit:

```bash
git add -A
git commit -m "Widget rail: final verification pass"
```

---

## Self-review notes (already applied)

- Task 5 deliberately keeps `widgetFileIssues` as a stateless placeholder (`useState` without the setter) so `noUnusedLocals` stays green until Task 7 wires sync — the seam is documented in both tasks.
- The registry stays React-free so the Node verify runtime can bundle registry + sources + mirror without a DOM.
- `mirror.ts` grows a registry import; the dependency direction (mirror → widgets/registry → widgets/sources → db) is acyclic.
- Scroll behavior change (whole widget stack scrolls; calendar no longer pinned) is called out in Task 5 and is intentional.
