import { db, type WidgetRow } from "./db";
import { getSettings } from "./settings";

// the widgets every install starts with — the rail's historical layout.
// updatedAt 0 means any mirrored widgets/ file wins the first sync merge, so
// a folder from another machine restores its widget setup cleanly. calendar
// and noted-days sit in the left rail; scratchpad is the sole right-rail seed,
// replacing the old fixed right panel.
export const CORE_WIDGETS: WidgetRow[] = [
  { id: "calendar", type: "calendar", title: "", config: {}, order: 0, enabled: true, column: "left", updatedAt: 0 },
  { id: "noted-days", type: "day-list", title: "days with notes", config: {}, order: 1, enabled: true, column: "left", updatedAt: 0 },
  { id: "scratchpad", type: "scratchpad", title: "scratchpad", config: {}, order: 0, enabled: true, column: "right", updatedAt: 0 },
];

// slug ids double as mirror filenames (widgets/<id>.json)
export const WIDGET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

// the rail has exactly two columns; anything unrecognized (missing, garbage,
// an older backup's absent field) falls back to the left column
export function sanitizeColumn(value: unknown): "left" | "right" {
  return value === "right" ? "right" : "left";
}

export function isCoreWidget(id: string): boolean {
  return CORE_WIDGETS.some((core) => core.id === id);
}

// seed core widgets that have NO row at all — first run, or a core widget
// added by an app update. never touches rows the user has edited or disabled,
// and never resurrects a core widget the user deleted (a live tombstone blocks
// reseeding, the same signal that stops a stale mirror file from restoring it)
export async function ensureDefaultWidgets(): Promise<void> {
  // one-time carry-over: the scratchpad used to be a settings toggle. when its
  // widget row is first seeded, inherit the user's legacy settings.scratchpad
  // choice so an install that had it off doesn't gain a surprise scratchpad.
  // read outside the write transaction (getSettings touches db.meta, which the
  // rw block below doesn't scope) and only when the row is actually missing.
  const scratchpadMissing = !(await db.widgets.get("scratchpad"));
  const legacyScratchpadEnabled = scratchpadMissing ? (await getSettings()).scratchpad : true;
  // read tombstones outside the transaction too — readWidgetTombstones touches
  // db.meta, which the widgets-only rw block below doesn't scope
  const tombstones = await readWidgetTombstones();
  await db.transaction("rw", db.widgets, async () => {
    for (const core of CORE_WIDGETS) {
      const existing = await db.widgets.get(core.id);
      if (!existing) {
        if (core.id in tombstones) continue; // deleted cores stay deleted
        const enabled = core.id === "scratchpad" ? legacyScratchpadEnabled : core.enabled;
        await db.widgets.put({ ...core, enabled });
      }
    }
    // one-time rename: the day list's heading was "noted days". an install that
    // never customized it moves to "days with notes" with a normal edit stamp;
    // a user-chosen title is left untouched
    const notedDays = await db.widgets.get("noted-days");
    if (notedDays && notedDays.title === "noted days") {
      await db.widgets.put({ ...notedDays, title: "days with notes", updatedAt: Date.now() });
    }
    // one-time field backfill: rows written before `column` existed gain
    // "left" without touching updatedAt — this is a format fill, not a user
    // edit, so it must not win a sync merge against another machine's copy
    for (const row of await db.widgets.toArray()) {
      if (row.column === undefined) await db.widgets.put({ ...row, column: "left" });
    }
  });
}

export async function listWidgets(): Promise<WidgetRow[]> {
  const rows = await db.widgets.toArray();
  return rows.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export async function saveWidget(row: WidgetRow): Promise<void> {
  await db.widgets.put(row);
  // an id that comes back to life must not be blocked by an old tombstone
  await clearWidgetTombstone(row.id);
}

const TOMBSTONES_ID = "widgetTombstones";
const TOMBSTONE_TTL = 30 * 24 * 60 * 60 * 1000;

// deletion leaves a tombstone so the mirror sync can tell "stale file to
// remove" from "file the user/agent re-created on purpose" — and so Phase 2
// sync has its delete seam. pruned after 30 days.
export async function readWidgetTombstones(): Promise<Record<string, number>> {
  const row = await db.meta.get(TOMBSTONES_ID);
  const value = (row?.value ?? {}) as Record<string, number>;
  const now = Date.now();
  const live = Object.fromEntries(Object.entries(value).filter(([, at]) => now - at < TOMBSTONE_TTL));
  return live;
}

export async function clearWidgetTombstone(id: string): Promise<void> {
  const tombstones = await readWidgetTombstones();
  if (id in tombstones) {
    delete tombstones[id];
    await db.meta.put({ id: TOMBSTONES_ID, value: tombstones });
  }
}

export async function deleteWidget(id: string): Promise<void> {
  await db.transaction("rw", db.widgets, db.panels, db.meta, async () => {
    await db.widgets.delete(id);
    // a non-core scratchpad widget's content lives in a `widget:<id>` panel row.
    // remove it in the same transaction so a reused id (uniqueWidgetId only
    // checks live widgets) or a backup export/import can't resurrect the old
    // private text. the core scratchpad's panel is plain "scratchpad", never
    // "widget:scratchpad", so this naturally spares it; non-scratchpad widgets
    // simply have no such row and the delete is a harmless no-op.
    await db.panels.delete(`widget:${id}`);
    const row = await db.meta.get(TOMBSTONES_ID);
    const tombstones = (row?.value ?? {}) as Record<string, number>;
    tombstones[id] = Date.now();
    await db.meta.put({ id: TOMBSTONES_ID, value: tombstones });
  });
}
