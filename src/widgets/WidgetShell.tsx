import type { WidgetRow } from "../db/db";
import { widgetProblem, widgetRegistry } from "./registry";
import type { WidgetDataInput } from "./sources";
import { CalendarWidget } from "./CalendarWidget";
import { DayListWidget } from "./DayListWidget";
import { CounterWidget, TaskRollupWidget, TextWidget } from "./SimpleWidgets";

// everything a widget may see or do — read-only data plus jump-to-date
export interface WidgetContext {
  data: WidgetDataInput;
  weekStartsOn: 0 | 1;
  currentTopKey: string;
  privacyMode: boolean;
  onJumpToDate: (date: Date) => void;
}

interface WidgetProps {
  row: WidgetRow;
  context: WidgetContext;
}

export function WidgetShell({ row, context }: WidgetProps) {
  const problem = widgetProblem(row);
  const label = row.title || widgetRegistry[row.type]?.label || row.type;

  return (
    <section className={`rail-widget widget-${row.type}`} aria-label={label}>
      {row.title ? <h2>{row.title}</h2> : null}
      {problem ? <p className="widget-error">{`"${row.id}" can't render: ${problem}`}</p> : <WidgetBody row={row} context={context} />}
    </section>
  );
}

function WidgetBody({ row, context }: WidgetProps) {
  switch (row.type) {
    case "calendar":
      return <CalendarWidget context={context} />;
    case "day-list":
      return <DayListWidget row={row} context={context} />;
    case "counter":
      return <CounterWidget row={row} context={context} />;
    case "task-rollup":
      return <TaskRollupWidget row={row} context={context} />;
    case "text":
      return <TextWidget row={row} context={context} />;
    default:
      return null;
  }
}
