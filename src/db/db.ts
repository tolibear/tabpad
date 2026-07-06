import Dexie, { type Table } from "dexie";
import type { AccentColor, ThemePreference } from "../lib/theme";

export interface DayRow {
  date: string;
  main: string;
  margin: string;
  createdAt: number;
  updatedAt: number;
}

export interface PanelRow {
  id: "scratchpad" | "masterList";
  content: string;
  updatedAt: number;
}

export interface Settings {
  theme: ThemePreference;
  accent: AccentColor;
  rightPanel: "scratchpad" | "margin" | "hidden";
  weekStartsOn: 0 | 1;
  editorSize: "sm" | "md" | "lg";
  font: "sans" | "serif" | "mono";
  mirrorEnabled: boolean;
}

export interface MetaRow {
  id: string;
  value: unknown;
}

export const defaultSettings: Settings = {
  theme: "system",
  accent: "blue",
  rightPanel: "scratchpad",
  weekStartsOn: 0,
  editorSize: "md",
  font: "sans",
  mirrorEnabled: false,
};

export class DaybookDB extends Dexie {
  days!: Table<DayRow, string>;
  panels!: Table<PanelRow, PanelRow["id"]>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super("daybook");
    this.version(1).stores({
      days: "date, updatedAt",
      panels: "id",
      meta: "id",
    });
  }
}

export const db = new DaybookDB();
