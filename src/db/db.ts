import Dexie, { type Table } from "dexie";
import type { AccentColor, ThemePreference } from "../lib/theme";

export interface DayRow {
  date: string;
  main: string;
  margin: string;
  createdAt: number;
  updatedAt: number;
  // per-field edit times so file sync can judge note and margin independently
  mainUpdatedAt?: number;
  marginUpdatedAt?: number;
}

export interface PanelRow {
  id: "scratchpad" | "masterList";
  content: string;
  updatedAt: number;
}

export type WidgetType = "calendar" | "day-list" | "counter" | "task-rollup" | "text" | "scratchpad";

export interface WidgetRow {
  id: string;
  type: WidgetType;
  title: string;
  config: Record<string, unknown>;
  order: number;
  enabled: boolean;
  // which rail the widget sits in — every seed, settings draft, file, and
  // import now carries it, so it is a required field; read paths that touch
  // untyped data still sanitize unknown values to a concrete "left"/"right"
  column: "left" | "right";
  updatedAt: number;
}

export interface Settings {
  theme: ThemePreference;
  accent: AccentColor;
  scratchpad: boolean;
  margins: boolean;
  weekStartsOn: 0 | 1;
  editorSize: "sm" | "md" | "lg";
  font: "sans" | "serif" | "mono";
}

export interface MetaRow {
  id: string;
  value: unknown;
}

export const defaultSettings: Settings = {
  theme: "system",
  accent: "blue",
  scratchpad: true,
  margins: false,
  weekStartsOn: 0,
  editorSize: "md",
  font: "sans",
};

export class TabPadDB extends Dexie {
  days!: Table<DayRow, string>;
  panels!: Table<PanelRow, PanelRow["id"]>;
  meta!: Table<MetaRow, string>;
  widgets!: Table<WidgetRow, string>;

  constructor() {
    super("tabpad");
    this.version(1).stores({
      days: "date, updatedAt",
      panels: "id",
      meta: "id",
    });
    this.version(2).stores({
      widgets: "id, order",
    });
  }
}

export const db = new TabPadDB();

// one-time carry-over from the pre-rename "daybook" database: notes, panels,
// settings, and the notes-folder connection all move across, then the old
// database is deleted
export async function migrateLegacyDb(): Promise<void> {
  try {
    if (!(await Dexie.exists("daybook"))) return;

    const counts = await Promise.all([db.days.count(), db.panels.count(), db.meta.count()]);
    if (counts.every((count) => count === 0)) {
      const legacy = new Dexie("daybook");
      legacy.version(1).stores({ days: "date, updatedAt", panels: "id", meta: "id" });
      await legacy.open();
      const [days, panels, meta] = await Promise.all([
        legacy.table("days").toArray(),
        legacy.table("panels").toArray(),
        legacy.table("meta").toArray(),
      ]);
      await db.transaction("rw", db.days, db.panels, db.meta, async () => {
        if (days.length) await db.days.bulkPut(days);
        if (panels.length) await db.panels.bulkPut(panels);
        if (meta.length) await db.meta.bulkPut(meta);
      });
      legacy.close();
    }
    await Dexie.delete("daybook");
  } catch (error) {
    console.warn("Tab Pad legacy database migration failed", error);
  }
}
