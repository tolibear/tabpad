import type { WidgetRow } from "../db/db";
import { dateFromKey, shortDate, shortWeekday } from "../lib/dates";
import { scrambleText } from "../lib/scramble";
import { sanitizeDayListConfig } from "./registry";
import { notedDayRows } from "./sources";
import type { WidgetContext } from "./WidgetShell";

export function DayListWidget({ row, context }: { row: WidgetRow; context: WidgetContext }) {
  const config = sanitizeDayListConfig(row.config);
  const rows = notedDayRows(context.data, config.limit, config.order);

  if (!rows.length) return <p className="empty-rail">no notes yet</p>;

  return (
    <div className="noted-list">
      {rows.map((entry) => {
        const date = dateFromKey(entry.date);

        return (
          <button
            className={entry.date === context.currentTopKey ? "noted-row active" : "noted-row"}
            key={entry.date}
            type="button"
            onClick={() => {
              if (date) context.onJumpToDate(date);
            }}
          >
            <span className="noted-date">
              {date ? shortDate(date) : entry.date} {date ? `· ${shortWeekday(date)}` : ""}
            </span>
            <span className="noted-excerpt">{context.privacyMode ? scrambleText(entry.excerpt) : entry.excerpt}</span>
          </button>
        );
      })}
    </div>
  );
}
