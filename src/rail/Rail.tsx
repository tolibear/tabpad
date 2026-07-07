import { Link2Off, Lock, LockOpen, Settings } from "lucide-react";
import type { WidgetRow } from "../db/db";
import { sanitizeColumn } from "../db/widgets";
import type { MirrorStatus, WidgetFileIssue } from "../mirror/mirror";
import { WidgetShell, type WidgetContext } from "../widgets/WidgetShell";

interface RailProps {
  widgets: WidgetRow[];
  widgetFileIssues: WidgetFileIssue[];
  context: WidgetContext;
  mirrorStatus: MirrorStatus;
  privacyMode: boolean;
  onOpenSettings: () => void;
  onReconnectMirror: () => void;
  onTogglePrivacy: () => void;
}

// the left rail carries the app chrome (brand, privacy, settings) plus every
// widget assigned to the left column
export function Rail({
  widgets,
  widgetFileIssues,
  context,
  mirrorStatus,
  privacyMode,
  onOpenSettings,
  onReconnectMirror,
  onTogglePrivacy,
}: RailProps) {
  const needsReconnect = mirrorStatus === "reconnect" || mirrorStatus === "error";
  const needsSetup = mirrorStatus === "off";
  const leftWidgets = widgets.filter((row) => row.enabled && sanitizeColumn(row.column) === "left");

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
        {leftWidgets.map((row) => (
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

// the right rail mirrors the left rail's widget shell but carries no chrome;
// when no widget is assigned there (or all are disabled) it renders nothing so
// the layout collapses back to two columns with no empty gutter
export function RightRail({ widgets, context }: { widgets: WidgetRow[]; context: WidgetContext }) {
  const rightWidgets = widgets.filter((row) => row.enabled && sanitizeColumn(row.column) === "right");
  if (!rightWidgets.length) return null;

  return (
    <aside className="rail rail-right" aria-label="Tab Pad sidebar">
      <div className="rail-widgets">
        {rightWidgets.map((row) => (
          <WidgetShell key={row.id} row={row} context={context} />
        ))}
      </div>
    </aside>
  );
}
