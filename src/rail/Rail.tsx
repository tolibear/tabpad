import {
  ChevronLeft,
  ChevronRight,
  Link2Off,
  Lock,
  LockOpen,
  Settings,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DayRow } from "../db/db";
import { firstLineExcerpt, hasDayContent } from "../db/days";
import { calendarDays, dateFromKey, dateKey, monthLabel, shortDate, shortWeekday } from "../lib/dates";
import type { MirrorStatus } from "../mirror/mirror";

interface RailProps {
  today: Date;
  todayText: string;
  contentDays: DayRow[];
  weekStartsOn: 0 | 1;
  currentTopKey: string;
  mirrorStatus: MirrorStatus;
  mirrorName: string;
  privacyMode: boolean;
  onJumpToDate: (date: Date) => void;
  onOpenSettings: () => void;
  onReconnectMirror: () => void;
  onTogglePrivacy: () => void;
}

export function Rail({
  today,
  todayText,
  contentDays,
  weekStartsOn,
  currentTopKey,
  mirrorStatus,
  mirrorName,
  privacyMode,
  onJumpToDate,
  onOpenSettings,
  onReconnectMirror,
  onTogglePrivacy,
}: RailProps) {
  const needsReconnect = mirrorStatus === "reconnect" || mirrorStatus === "error";
  const needsSetup = mirrorStatus === "off";

  return (
    <aside className="rail" aria-label="Tab Pad navigation">
      <div className="rail-mark">
        <span className="brand-dot" aria-hidden="true" />
        <span>tab pad</span>
        {/* the link icon only appears when something is wrong — a healthy
            connection needs no chrome */}
        {needsReconnect ? (
          <button
            className="link-indicator broken"
            type="button"
            aria-label="notes folder disconnected — click to reconnect"
            title="disconnected — click to reconnect"
            onClick={onReconnectMirror}
          >
            <Link2Off aria-hidden="true" size={13} strokeWidth={2} />
          </button>
        ) : null}
        <button
          className={privacyMode ? "privacy-toggle locked" : "privacy-toggle"}
          type="button"
          aria-label={privacyMode ? "show notes" : "hide notes (privacy mode)"}
          aria-pressed={privacyMode}
          title={privacyMode ? "show notes" : "hide notes (privacy mode)"}
          onClick={onTogglePrivacy}
        >
          {privacyMode ? (
            <Lock aria-hidden="true" size={13} strokeWidth={2} />
          ) : (
            <LockOpen aria-hidden="true" size={13} strokeWidth={2} />
          )}
        </button>
        <button className="icon-button rail-settings" type="button" aria-label="settings" onClick={onOpenSettings}>
          <Settings aria-hidden="true" size={17} strokeWidth={1.8} />
        </button>
      </div>
      <MiniCalendar
        today={today}
        todayText={todayText}
        contentDays={contentDays}
        weekStartsOn={weekStartsOn}
        onJumpToDate={onJumpToDate}
      />
      <NotedDays
        today={today}
        todayText={todayText}
        contentDays={contentDays}
        currentTopKey={currentTopKey}
        onJumpToDate={onJumpToDate}
      />
      <div className="rail-bottom">
        {needsReconnect ? (
          <button className="reconnect-chip" type="button" onClick={onReconnectMirror}>
            reconnect notes folder
          </button>
        ) : null}
        {needsSetup ? (
          <button className="reconnect-chip" type="button" onClick={onOpenSettings}>
            choose your notes folder
          </button>
        ) : null}
      </div>
    </aside>
  );
}

interface MiniCalendarProps {
  today: Date;
  todayText: string;
  contentDays: DayRow[];
  weekStartsOn: 0 | 1;
  onJumpToDate: (date: Date) => void;
}

function MiniCalendar({ today, todayText, contentDays, weekStartsOn, onJumpToDate }: MiniCalendarProps) {
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  // a pinned new tab lives across month rollovers — snap the calendar to the
  // new month when today moves into one (manual browsing is untouched
  // otherwise)
  const todayMonthKey = `${today.getFullYear()}-${today.getMonth()}`;
  useEffect(() => {
    setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayMonthKey]);
  const contentKeys = useMemo(() => contentKeySet(today, todayText, contentDays), [contentDays, today, todayText]);
  const days = useMemo(
    () => calendarDays(visibleMonth, today, contentKeys, weekStartsOn),
    [contentKeys, today, visibleMonth, weekStartsOn],
  );
  const weekdays = useMemo(() => weekdayInitials(weekStartsOn), [weekStartsOn]);

  return (
    <section className="calendar-shell" aria-label="calendar">
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
            onClick={() => onJumpToDate(day.date)}
          >
            <span>{day.day}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

interface NotedDaysProps {
  today: Date;
  todayText: string;
  contentDays: DayRow[];
  currentTopKey: string;
  onJumpToDate: (date: Date) => void;
}

function NotedDays({ today, todayText, contentDays, currentTopKey, onJumpToDate }: NotedDaysProps) {
  const rows = useMemo(() => notedRows(today, todayText, contentDays), [contentDays, today, todayText]);

  return (
    <section className="noted-days" aria-label="noted days">
      <h2>noted days</h2>
      <div className="noted-list">
        {rows.length ? (
          rows.map((row) => {
            const date = dateFromKey(row.date);

            return (
              <button
                className={row.date === currentTopKey ? "noted-row active" : "noted-row"}
                key={row.date}
                type="button"
                onClick={() => {
                  if (date) onJumpToDate(date);
                }}
              >
                <span className="noted-date">
                  {date ? shortDate(date) : row.date} {date ? `· ${shortWeekday(date)}` : ""}
                </span>
                <span className="noted-excerpt">{row.excerpt}</span>
              </button>
            );
          })
        ) : (
          <p className="empty-rail">no notes yet</p>
        )}
      </div>
    </section>
  );
}

function contentKeySet(today: Date, todayText: string, rows: DayRow[]): Set<string> {
  const keys = new Set(rows.filter((row) => hasDayContent(row.main, row.margin)).map((row) => row.date));
  if (hasDayContent(todayText)) {
    keys.add(dateKey(today));
  }
  return keys;
}

function notedRows(today: Date, todayText: string, rows: DayRow[]): Array<{ date: string; excerpt: string }> {
  const byDate = new Map<string, { date: string; excerpt: string }>();

  for (const row of rows) {
    if (hasDayContent(row.main, row.margin)) {
      byDate.set(row.date, {
        date: row.date,
        excerpt: firstLineExcerpt(row.main || row.margin) || "margin note",
      });
    }
  }

  if (hasDayContent(todayText)) {
    byDate.set(dateKey(today), { date: dateKey(today), excerpt: firstLineExcerpt(todayText) || "today" });
  }

  return Array.from(byDate.values())
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 50);
}

function addMonths(date: Date, offset: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

function weekdayInitials(weekStartsOn: 0 | 1): string[] {
  const sundayFirst = ["s", "m", "t", "w", "t", "f", "s"];
  if (weekStartsOn === 0) return sundayFirst;

  return [...sundayFirst.slice(1), sundayFirst[0]];
}
