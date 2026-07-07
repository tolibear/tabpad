import type { WidgetRow } from "../db/db";
import { dateFromKey, shortDate } from "../lib/dates";
import { scrambleText } from "../lib/scramble";
import { sanitizeCounterConfig, sanitizeTaskRollupConfig, sanitizeTextConfig } from "./registry";
import { computeSource, openTasks } from "./sources";
import type { WidgetContext } from "./WidgetShell";

export function CounterWidget({ row, context }: { row: WidgetRow; context: WidgetContext }) {
  const config = sanitizeCounterConfig(row.config);
  const value = computeSource(config.source, context.data);
  return <p className="widget-counter">{config.format.replaceAll("{n}", String(value))}</p>;
}

export function TaskRollupWidget({ row, context }: { row: WidgetRow; context: WidgetContext }) {
  const config = sanitizeTaskRollupConfig(row.config);
  const tasks = openTasks(context.data, config.days, config.limit);

  if (!tasks.length) return <p className="empty-rail">no open to-dos</p>;

  return (
    <div className="noted-list">
      {tasks.map((task, index) => {
        const date = dateFromKey(task.date);
        return (
          <button
            className={`noted-row${task.inProgress ? " task-progress" : ""}`}
            key={`${task.date}-${index}`}
            type="button"
            onClick={() => {
              if (date) context.onJumpToDate(date, { taskText: task.text });
            }}
          >
            <span className="noted-date">{date ? shortDate(date) : task.date}</span>
            <span className="noted-excerpt">{context.privacyMode ? scrambleText(task.text) : task.text}</span>
          </button>
        );
      })}
    </div>
  );
}

export function TextWidget({ row, context }: { row: WidgetRow; context: WidgetContext }) {
  const config = sanitizeTextConfig(row.config);
  return <p className="widget-text">{context.privacyMode ? scrambleText(config.content) : config.content}</p>;
}
