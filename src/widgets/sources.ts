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
  { value: "streak", label: "consecutive days with notes" },
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

// prefer the first markdown heading among the first 5 non-empty lines —
// notes often lead with a stray word before their real title — else the
// plain first-line excerpt. markdown is stripped either way.
function headingFirstExcerpt(text: string): string {
  const nonEmpty: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim()) nonEmpty.push(line);
    if (nonEmpty.length >= 5) break;
  }
  const heading = nonEmpty.find((line) => /^#{1,6}\s+/.test(line.trim()));
  return firstLineExcerpt(heading ?? text);
}

export function notedDayRows(
  input: WidgetDataInput,
  limit = 50,
  order: "newest" | "oldest" = "newest",
): Array<{ date: string; excerpt: string }> {
  const rows = Array.from(collectDays(input).entries()).map(([date, { main, margin }]) => ({
    date,
    excerpt: headingFirstExcerpt(main || margin) || (date === input.todayKey ? "today" : "margin note"),
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

// an open to-do is either `- [ ]` (not started) or `- [/]` (in progress) —
// both still count as open; only `- [x]` is done
const OPEN_TASK = /^\s*- \[([ /])\]\s+(.+)$/;

// the click cycle for a task marker: open → in progress → done → open.
// takes the 3-char marker ("[ ]" | "[/]" | "[x]"), returns the next one.
export function nextTaskMarker(current: string): string {
  const state = current[1]?.toLowerCase();
  if (state === " ") return "[/]";
  if (state === "/") return "[x]";
  return "[ ]";
}

// open `- [ ]`/`- [/]` lines, newest day first. days=0 means no window; future
// days always pass the window (planned to-dos should surface). in-progress
// rows carry inProgress:true so the UI can mark them.
export function openTasks(
  input: WidgetDataInput,
  days = 0,
  limit = Number.POSITIVE_INFINITY,
): Array<{ date: string; text: string; inProgress: boolean }> {
  const floor = days > 0 ? dateKey(addDays(input.today, -(days - 1))) : "";
  const tasks: Array<{ date: string; text: string; inProgress: boolean }> = [];
  const entries = Array.from(collectDays(input).entries()).sort((a, b) => b[0].localeCompare(a[0]));
  for (const [date, { main, margin }] of entries) {
    if (date < floor) continue;
    for (const line of `${main}\n${margin}`.split(/\r?\n/)) {
      if (tasks.length >= limit) return tasks;
      const match = OPEN_TASK.exec(line);
      if (match) tasks.push({ date, text: match[2].trim(), inProgress: match[1] === "/" });
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
