import { dateFromKey } from "../lib/dates";
import { db, defaultSettings, type DayRow, type PanelRow, type Settings } from "./db";
import { getSettings } from "./settings";

export interface DaybookExport {
  schemaVersion: 1;
  exportedAt: number;
  days: DayRow[];
  panels: PanelRow[];
  settings: Settings;
}

export async function createExportPayload(): Promise<DaybookExport> {
  const [days, panels, settings] = await Promise.all([db.days.toArray(), db.panels.toArray(), getSettings()]);
  return {
    schemaVersion: 1,
    exportedAt: Date.now(),
    days,
    panels,
    settings,
  };
}

export function serializeExport(payload: DaybookExport): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export async function importPayload(payload: unknown): Promise<{ daysImported: number; panelsImported: number }> {
  const parsed = parsePayload(payload);
  let daysImported = 0;
  let panelsImported = 0;

  await db.transaction("rw", db.days, db.panels, db.meta, async () => {
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

    if (parsed.hasSettings) {
      await db.meta.put({ id: "settings", value: { ...defaultSettings, ...parsed.settings } });
    }
  });

  return { daysImported, panelsImported };
}

function parsePayload(payload: unknown): DaybookExport & { hasSettings: boolean } {
  if (!isObject(payload) || payload.schemaVersion !== 1) {
    throw new Error("Unsupported Daybook export");
  }

  return {
    schemaVersion: 1,
    exportedAt: typeof payload.exportedAt === "number" ? payload.exportedAt : Date.now(),
    days: Array.isArray(payload.days) ? payload.days.filter(isDayRow).map(clampDayTimestamps) : [],
    panels: Array.isArray(payload.panels) ? payload.panels.filter(isPanelRow) : [],
    settings: isObject(payload.settings) ? sanitizeSettings(payload.settings) : defaultSettings,
    hasSettings: isObject(payload.settings),
  };
}

// imported timestamps must not be in the future, or they would win every
// merge against legitimate local edits forever
function clampDayTimestamps(day: DayRow): DayRow {
  const now = Date.now();
  return { ...day, createdAt: Math.min(day.createdAt, now), updatedAt: Math.min(day.updatedAt, now) };
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
    mirrorEnabled: value.mirrorEnabled === true,
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
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number"
  );
}

function isPanelRow(value: unknown): value is PanelRow {
  return (
    isObject(value) &&
    (value.id === "scratchpad" || value.id === "masterList") &&
    typeof value.content === "string" &&
    typeof value.updatedAt === "number"
  );
}
