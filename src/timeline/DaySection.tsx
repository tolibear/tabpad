import { Target } from "lucide-react";
import { dateKey, shortDate, shortWeekday } from "../lib/dates";
import { EditorSurface } from "../editor/EditorSurface";
import { StaticDay } from "./StaticDay";

export interface DaySectionProps {
  date: Date;
  value: string;
  isToday?: boolean;
  isStatic?: boolean;
  isFocusDay?: boolean;
  showMargin?: boolean;
  marginValue?: string;
  registerRef?: (node: HTMLElement | null) => void;
  onActivate?: (part: "main" | "margin") => void;
  onToggleFocus?: () => void;
  onValueChange: (value: string) => void;
  onMarginChange?: (value: string) => void;
  onBlur?: () => void;
  onMarginBlur?: () => void;
  onFocusChange?: (focused: boolean) => void;
  onMarginFocusChange?: (focused: boolean) => void;
}

export function DaySection({
  date,
  value,
  isToday = false,
  isStatic = false,
  isFocusDay = false,
  showMargin = false,
  marginValue = "",
  registerRef,
  onActivate,
  onToggleFocus,
  onValueChange,
  onMarginChange,
  onBlur,
  onMarginBlur,
  onFocusChange,
  onMarginFocusChange,
}: DaySectionProps) {
  return (
    <article
      className={["day-section", isToday ? "today" : "", showMargin ? "with-margin" : "", isFocusDay ? "focus-day" : ""]
        .filter(Boolean)
        .join(" ")}
      data-date={dateKey(date)}
      ref={registerRef}
    >
      <header className="day-header">
        <span className="date-number">{shortDate(date)}</span>
        <span className="weekday">{shortWeekday(date)}</span>
        {isToday ? <span className="today-dot" aria-hidden="true" /> : null}
        {onToggleFocus ? (
          <button
            className={isFocusDay ? "focus-toggle active" : "focus-toggle"}
            type="button"
            aria-label={isFocusDay ? "exit focus mode" : "focus on this day"}
            aria-pressed={isFocusDay}
            title={isFocusDay ? "exit focus mode (esc)" : "focus on this day"}
            // preventDefault keeps the editor's caret — otherwise the click
            // blurs the editor, isActive drops, and the button vanishes
            // before its own click lands
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();
              onToggleFocus();
            }}
          >
            <Target aria-hidden="true" size={14} strokeWidth={1.8} />
          </button>
        ) : null}
      </header>
      <div className={showMargin ? "day-content-grid" : ""}>
        <div
          className="day-body"
          onClick={(event) => {
            // clicking ANYWHERE inside the day block starts writing there —
            // including the empty space around a static day's text, which is
            // most of the block
            const target = event.target as HTMLElement;
            if (target.closest("input")) return; // checkbox toggles stay in StaticDay
            if (isStatic) {
              onActivate?.("main");
              return;
            }
            if (target.closest(".cm-editor")) return;
            focusEditorAtEnd(event.currentTarget);
          }}
        >
          {isStatic ? (
            <div className="static-day-shell">
              {value ? <StaticDay source={value} onChange={onValueChange} /> : <p className="static-empty-day">&nbsp;</p>}
            </div>
          ) : (
            <EditorSurface
              autofocus={isToday}
              className={isToday ? "primary-editor" : "secondary-day-editor"}
              placeholder={isToday ? "write..." : ""}
              value={value}
              onBlur={onBlur}
              onChange={onValueChange}
              onFocusChange={onFocusChange}
            />
          )}
        </div>
        {showMargin ? (
          <aside
            className="day-margin"
            aria-label={`${shortDate(date)} margin`}
            onClick={(event) => {
              // clicking empty margin space drops the cursor into the margin editor
              const target = event.target as HTMLElement;
              if (target.closest("input")) return;
              if (isStatic) {
                onActivate?.("margin");
                return;
              }
              if (target.closest(".cm-editor")) return;
              focusEditorAtEnd(event.currentTarget);
            }}
          >
            {isStatic ? (
              <div className="static-day-shell">
                {marginValue ? <StaticDay source={marginValue} onChange={(next) => onMarginChange?.(next)} /> : <p className="static-empty-day">&nbsp;</p>}
              </div>
            ) : (
              <EditorSurface
                className="margin-editor"
                placeholder=""
                value={marginValue}
                onBlur={onMarginBlur}
                onChange={(next) => onMarginChange?.(next)}
                onFocusChange={onMarginFocusChange}
              />
            )}
          </aside>
        ) : null}
      </div>
    </article>
  );
}

export function focusEditorAtEnd(container: HTMLElement): void {
  const content = container.querySelector<HTMLElement>(".cm-content");
  if (!content) return;
  content.focus();
  // drop the caret at the end of the note; CodeMirror picks the DOM selection up
  const selection = window.getSelection();
  if (selection) {
    selection.selectAllChildren(content);
    selection.collapseToEnd();
  }
}
