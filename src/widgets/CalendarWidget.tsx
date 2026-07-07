import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { calendarDays, monthLabel } from "../lib/dates";
import { contentDateKeys } from "./sources";
import type { WidgetContext } from "./WidgetShell";

export function CalendarWidget({ context }: { context: WidgetContext }) {
  const { today } = context.data;
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  // a pinned new tab lives across month rollovers — snap the calendar to the
  // new month when today moves into one (manual browsing is untouched
  // otherwise)
  const todayMonthKey = `${today.getFullYear()}-${today.getMonth()}`;
  useEffect(() => {
    setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayMonthKey]);
  const contentKeys = useMemo(() => contentDateKeys(context.data), [context.data]);
  const days = useMemo(
    () => calendarDays(visibleMonth, today, contentKeys, context.weekStartsOn),
    [contentKeys, today, visibleMonth, context.weekStartsOn],
  );
  const weekdays = useMemo(() => weekdayInitials(context.weekStartsOn), [context.weekStartsOn]);

  return (
    <>
      <div className="month-row">
        <button
          className="icon-button ghost"
          type="button"
          aria-label="previous month"
          onClick={() => setVisibleMonth((date) => addMonths(date, -1))}
        >
          <ChevronLeft aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>
        <button
          className="month-label"
          type="button"
          onClick={() => setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1))}
        >
          {monthLabel(visibleMonth)}
        </button>
        <button
          className="icon-button ghost"
          type="button"
          aria-label="next month"
          onClick={() => setVisibleMonth((date) => addMonths(date, 1))}
        >
          <ChevronRight aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>
      </div>
      <div className="weekday-grid" aria-hidden="true">
        {weekdays.map((weekday, index) => (
          <span key={`${weekday}-${index}`}>{weekday}</span>
        ))}
      </div>
      <div className="date-grid">
        {days.map((day) => (
          <button
            className={[
              "date-cell",
              day.inMonth ? "" : "outside",
              day.isToday ? "today" : "",
              day.hasContent ? "noted" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            key={day.key}
            type="button"
            aria-label={day.date.toDateString()}
            onClick={() => context.onJumpToDate(day.date)}
          >
            <span>{day.day}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function addMonths(date: Date, offset: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

function weekdayInitials(weekStartsOn: 0 | 1): string[] {
  const sundayFirst = ["s", "m", "t", "w", "t", "f", "s"];
  if (weekStartsOn === 0) return sundayFirst;

  return [...sundayFirst.slice(1), sundayFirst[0]];
}
