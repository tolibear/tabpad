import type { DayRow } from "../db/db";
import { addDays, dateKey, daysBetween } from "../lib/dates";

export interface TimelineEntry {
  key: string;
  date: Date;
  kind: "future" | "today" | "past";
  source?: DayRow;
}

export interface TimelineWindowOptions {
  today: Date;
  futureCount: number;
  pastCount: number;
  contentDays: DayRow[];
}

export function buildTimelineWindow({ today, futureCount, pastCount, contentDays }: TimelineWindowOptions): TimelineEntry[] {
  const todayKey = dateKey(today);
  const sources = new Map(contentDays.map((row) => [row.date, row]));
  const entries: TimelineEntry[] = [];

  for (let offset = futureCount; offset >= -pastCount; offset -= 1) {
    const date = offset === 0 ? today : addDays(today, offset);
    const key = dateKey(date);
    entries.push({
      key,
      date,
      kind: offset === 0 ? "today" : offset > 0 ? "future" : "past",
      source: sources.get(key),
    });
  }

  return entries;
}

export function requiredFutureCount(today: Date, target: Date): number {
  return Math.max(0, daysBetween(today, target));
}

export function requiredPastCount(today: Date, target: Date): number {
  return Math.max(0, daysBetween(target, today));
}
