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
