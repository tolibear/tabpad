import { dateFromKey } from "../lib/dates";
import { db, defaultSettings, type DayRow, type PanelRow, type Settings, type WidgetRow } from "./db";
import { getSettings } from "./settings";
import { CORE_WIDGETS, WIDGET_ID_PATTERN } from "./widgets";
import { isWidgetType, sanitizeWidgetConfig } from "../widgets/registry";

export interface TabPadExport {
  schemaVersion: 1;
  exportedAt: number;
  days: DayRow[];
  panels: PanelRow[];
  widgets: WidgetRow[];
  settings: Settings;
}

export async function createExportPayload(): Promise<TabPadExport> {
  const [days, panels, widgets, settings] = await Promise.all([
    db.days.toArray(),
    db.panels.toArray(),
    db.widgets.toArray(),
    getSettings(),
  ]);
  return {
    schemaVersion: 1,
    exportedAt: Date.now(),
    days,
    panels,
    widgets,
    settings,
  };
}

export function serializeExport(payload: TabPadExport): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export async function importPayload(payload: unknown): Promise<{ daysImported: number; panelsImported: number; widgetsImported: number }> {
  const parsed = parsePayload(payload);
  let daysImported = 0;
  let panelsImported = 0;
  let widgetsImported = 0;

  await db.transaction("rw", db.days, db.panels, db.widgets, db.meta, async () => {
    for (const day of parsed.days) {
      const existing = await db.days.get(day.date);
      if (!existing || day.updatedAt >= existing.updatedAt) {
        await db.days.put(day);
        daysImported += 1;
      }
    }

    for (const panel of parsed.panels) {
      const existing = await db.panels.get(panel.id);
      if (!existing || panel.updatedAt >= existing.updatedAt) {
        await db.panels.put(panel);
        panelsImported += 1;
      }
    }

    for (const widget of parsed.widgets) {
      const existing = await db.widgets.get(widget.id);
      if (!existing || widget.updatedAt >= existing.updatedAt) {
        await db.widgets.put(widget);
        widgetsImported += 1;
      }
    }

    if (parsed.hasSettings) {
      await db.meta.put({ id: "settings", value: { ...defaultSettings, ...parsed.settings } });
    }
  });

  return { daysImported, panelsImported, widgetsImported };
}

function parsePayload(payload: unknown): TabPadExport & { hasSettings: boolean } {
  // accept newer schema versions best-effort: rows are validated one by one
  // anyway, so a v2 export from a future build restores everything a v1 build
  // understands instead of failing outright
  if (!isObject(payload) || typeof payload.schemaVersion !== "number" || payload.schemaVersion < 1) {
    throw new Error("Unsupported Tab Pad export");
  }

  return {
    schemaVersion: 1,
    exportedAt: typeof payload.exportedAt === "number" ? payload.exportedAt : Date.now(),
    days: Array.isArray(payload.days) ? payload.days.filter(isDayRow).map(clampDayTimestamps) : [],
    panels: Array.isArray(payload.panels)
      ? payload.panels.filter(isPanelRow).map((panel) => ({ ...panel, updatedAt: Math.min(panel.updatedAt, Date.now()) }))
      : [],
    widgets: Array.isArray(payload.widgets)
      ? payload.widgets.filter(isWidgetRow).map((widget) => ({
          ...widget,
          config: sanitizeWidgetConfig(widget.type, widget.config),
          updatedAt: Math.min(widget.updatedAt, Date.now()),
        }))
      : [],
    settings: isObject(payload.settings) ? sanitizeSettings(payload.settings) : defaultSettings,
    hasSettings: isObject(payload.settings),
  };
}

// imported timestamps must not be in the future, or they would win every
// merge against legitimate local edits forever
function clampDayTimestamps(day: DayRow): DayRow {
  const now = Date.now();
  return {
    ...day,
    createdAt: Math.min(day.createdAt, now),
    updatedAt: Math.min(day.updatedAt, now),
    // the per-field stamps are what folder sync actually compares — clamp
    // them too, and drop non-numeric junk
    mainUpdatedAt: Number.isFinite(day.mainUpdatedAt) ? Math.min(day.mainUpdatedAt as number, now) : undefined,
    marginUpdatedAt: Number.isFinite(day.marginUpdatedAt) ? Math.min(day.marginUpdatedAt as number, now) : undefined,
  };
}

function sanitizeSettings(value: Record<string, unknown>): Settings {
  const pick = <K extends keyof Settings>(key: K, allowed: readonly Settings[K][]): Settings[K] =>
    allowed.includes(value[key] as Settings[K]) ? (value[key] as Settings[K]) : defaultSettings[key];

  return {
    theme: pick("theme", ["system", "light", "dark"]),
    accent: pick("accent", ["blue", "green", "red", "yellow", "orange", "purple"]),
    scratchpad: value.scratchpad !== false,
    margins: value.margins === true,
    weekStartsOn: pick("weekStartsOn", [0, 1]),
    editorSize: pick("editorSize", ["sm", "md", "lg"]),
    font: pick("font", ["sans", "serif", "mono"]),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDayRow(value: unknown): value is DayRow {
  return (
    isObject(value) &&
    typeof value.date === "string" &&
    dateFromKey(value.date) !== null &&
    typeof value.main === "string" &&
    typeof value.margin === "string" &&
    // NaN passes typeof but breaks every merge comparison forever
    Number.isFinite(value.createdAt) &&
    Number.isFinite(value.updatedAt)
  );
}

function isPanelRow(value: unknown): value is PanelRow {
  return (
    isObject(value) &&
    (value.id === "scratchpad" || value.id === "masterList") &&
    typeof value.content === "string" &&
    Number.isFinite(value.updatedAt)
  );
}

function isWidgetRow(value: unknown): value is WidgetRow {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    !WIDGET_ID_PATTERN.test(value.id) ||
    !isWidgetType(value.type) ||
    typeof value.title !== "string" ||
    !isObject(value.config) ||
    Array.isArray(value.config) || // isObject() alone lets arrays through
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
