import { Link2Off, Lock, LockOpen, Settings } from "lucide-react";
import { useMemo } from "react";
import type { DayRow, WidgetRow } from "../db/db";
import { dateKey } from "../lib/dates";
import type { MirrorStatus, WidgetFileIssue } from "../mirror/mirror";
import { WidgetShell, type WidgetContext } from "../widgets/WidgetShell";

interface RailProps {
  today: Date;
  todayText: string;
  contentDays: DayRow[];
  widgets: WidgetRow[];
  widgetFileIssues: WidgetFileIssue[];
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
  widgets,
  widgetFileIssues,
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
  const context: WidgetContext = useMemo(
    () => ({
      data: { today, todayKey: dateKey(today), todayText, contentDays },
      weekStartsOn,
      currentTopKey,
      privacyMode,
      onJumpToDate,
    }),
    [contentDays, currentTopKey, onJumpToDate, privacyMode, today, todayText, weekStartsOn],
  );

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
      <div className="rail-widgets">
        {widgets
          .filter((row) => row.enabled)
          .map((row) => (
            <WidgetShell key={row.id} row={row} context={context} />
          ))}
        {widgetFileIssues.map((issue) => (
          <section className="rail-widget" key={issue.file}>
            <p className="widget-error">{`${issue.file}: ${issue.error}`}</p>
          </section>
        ))}
      </div>
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
