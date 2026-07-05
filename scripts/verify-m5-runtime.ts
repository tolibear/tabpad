import { calendarDays, dateKey, parseDateJump } from "../src/lib/dates";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const today = new Date("2026-07-03T09:00:00");

assert(dateKey(parseDateJump("today", today) ?? new Date(0)) === "2026-07-03", "today must parse");
assert(dateKey(parseDateJump("tomorrow", today) ?? new Date(0)) === "2026-07-04", "tomorrow must parse");
assert(dateKey(parseDateJump("yesterday", today) ?? new Date(0)) === "2026-07-02", "yesterday must parse");
assert(dateKey(parseDateJump("2026-07-04", today) ?? new Date(0)) === "2026-07-04", "iso date must parse");
assert(dateKey(parseDateJump("7/4", today) ?? new Date(0)) === "2026-07-04", "month/day date must parse");
assert(parseDateJump("2026-02-29", today) === null, "invalid dates must be rejected");

const sundayFirst = calendarDays(new Date("2026-07-01T00:00:00"), today, new Set(), 0);
const mondayFirst = calendarDays(new Date("2026-07-01T00:00:00"), today, new Set(), 1);
assert(sundayFirst[0].key === "2026-06-28", "sunday-first calendar must start on Sunday");
assert(mondayFirst[0].key === "2026-06-29", "monday-first calendar must start on Monday");

const dotted = calendarDays(new Date("2026-07-01T00:00:00"), today, new Set(["2026-07-04"]), 0).find(
  (day) => day.key === "2026-07-04",
);
assert(dotted?.hasContent === true, "calendar dots must come from content keys");
