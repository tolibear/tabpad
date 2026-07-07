import type { DayRow } from "../src/db/db";
import { addDays, dateKey } from "../src/lib/dates";
import { buildTimelineWindow, requiredFutureCount } from "../src/timeline/Timeline";
import { toggleTaskLine } from "../src/timeline/StaticDay";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const today = new Date("2026-07-03T09:00:00");
const rows: DayRow[] = [
  { date: "2026-07-02", main: "yesterday", margin: "", createdAt: 1, updatedAt: 2 },
  { date: "2026-06-29", main: "older", margin: "", createdAt: 1, updatedAt: 2 },
];
// window now spans a fixed futureCount/pastCount range; inserted-key placeholders were removed
const windowEntries = buildTimelineWindow({
  today,
  futureCount: 3,
  contentDays: rows,
  pastCount: 14,
});

assert(windowEntries[0].key === "2026-07-06", "timeline must place farthest future date first");
assert(windowEntries[2].key === "2026-07-04", "timeline must place tomorrow immediately above today");
assert(windowEntries[3].key === "2026-07-03" && windowEntries[3].kind === "today", "today must sit after future dates");
assert(requiredFutureCount(today, addDays(today, 9)) === 9, "future jump sizing must match day distance");
assert(toggleTaskLine("- [ ] call", 0) === "- [x] call", "static task toggle must check unchecked tasks");
assert(toggleTaskLine("- [x] call", 0) === "- [ ] call", "static task toggle must uncheck checked tasks");
assert(dateKey(today) === "2026-07-03", "test sanity: date keys must remain local date strings");
