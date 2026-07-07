import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { WidgetRow, WidgetType } from "../db/db";
import { sanitizeColumn, WIDGET_ID_PATTERN } from "../db/widgets";
import { columnField, widgetRegistry, widgetTypes, type WidgetField } from "../widgets/registry";

interface WidgetSettingsProps {
  widgets: WidgetRow[];
  onToggle: (id: string, enabled: boolean) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onDelete: (id: string) => void;
  onSave: (row: WidgetRow) => void;
}

interface Draft {
  id: string | null; // null = adding
  type: WidgetType;
  title: string;
  column: "left" | "right";
  config: Record<string, unknown>;
}

export function WidgetSettings({ widgets, onToggle, onMove, onDelete, onSave }: WidgetSettingsProps) {
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  const startAdd = (type: WidgetType) => {
    setPicking(false);
    setDraft({ id: null, type, title: widgetRegistry[type].label, column: "left", config: { ...widgetRegistry[type].defaultConfig } });
  };

  const submit = () => {
    if (!draft) return;
    const existing = draft.id ? widgets.find((w) => w.id === draft.id) : undefined;
    onSave({
      id: draft.id ?? uniqueWidgetId(draft.title, draft.type, widgets),
      type: draft.type,
      title: draft.title.trim(),
      config: draft.config,
      order: existing?.order ?? (widgets.length ? Math.max(...widgets.map((w) => w.order)) + 1 : 0),
      enabled: existing?.enabled ?? true,
      column: draft.column,
      updatedAt: Date.now(),
    });
    setDraft(null);
  };

  return (
    <section className="settings-section" aria-label="sidebar">
      <h3>sidebar</h3>
      <div className="mode-list">
        {widgets.map((row, index) => (
          <div className="widget-row" key={row.id}>
            <button
              className={row.enabled ? "mode-choice selected widget-choice" : "mode-choice widget-choice"}
              type="button"
              role="switch"
              aria-checked={row.enabled}
              onClick={() => onToggle(row.id, !row.enabled)}
            >
              <span className="mode-row">
                {row.title || widgetRegistry[row.type]?.label || row.type}
                <span className={row.enabled ? "mode-switch on" : "mode-switch"} aria-hidden="true" />
              </span>
              <small>{widgetRegistry[row.type]?.label ?? row.type}</small>
            </button>
            <div className="widget-row-actions">
              <button
                className="icon-button ghost"
                type="button"
                aria-label={`move ${row.id} up`}
                disabled={index === 0}
                onClick={() => onMove(row.id, -1)}
              >
                <ChevronUp aria-hidden="true" size={14} strokeWidth={1.8} />
              </button>
              <button
                className="icon-button ghost"
                type="button"
                aria-label={`move ${row.id} down`}
                disabled={index === widgets.length - 1}
                onClick={() => onMove(row.id, 1)}
              >
                <ChevronDown aria-hidden="true" size={14} strokeWidth={1.8} />
              </button>
              <button
                className="icon-button ghost"
                type="button"
                aria-label={`edit ${row.id}`}
                onClick={() => setDraft({ id: row.id, type: row.type, title: row.title, column: sanitizeColumn(row.column), config: { ...row.config } })}
              >
                <Pencil aria-hidden="true" size={14} strokeWidth={1.8} />
              </button>
              <button
                className="icon-button ghost"
                type="button"
                aria-label={`delete ${row.id}`}
                onClick={() => onDelete(row.id)}
              >
                <Trash2 aria-hidden="true" size={14} strokeWidth={1.8} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {draft ? (
        <div className="widget-form">
          <label className="widget-field">
            <span>title</span>
            <input
              className="widget-field-input"
              type="text"
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </label>
          <label className="widget-field">
            <span>{columnField.label}</span>
            <FieldInput
              field={columnField}
              value={draft.column}
              onChange={(value) => setDraft({ ...draft, column: sanitizeColumn(value) })}
            />
          </label>
          {widgetRegistry[draft.type].fields.map((field) => (
            <label className="widget-field" key={field.key}>
              <span>{field.label}</span>
              <FieldInput
                field={field}
                value={draft.config[field.key]}
                onChange={(value) => setDraft({ ...draft, config: { ...draft.config, [field.key]: value } })}
              />
            </label>
          ))}
          <div className="widget-form-actions">
            <button className="data-button" type="button" onClick={submit}>
              <span>{draft.id ? "save widget" : "add widget"}</span>
            </button>
            <button className="data-button" type="button" onClick={() => setDraft(null)}>
              <span>cancel</span>
            </button>
          </div>
        </div>
      ) : picking ? (
        <div className="widget-type-list">
          {widgetTypes.map((type) => (
            <button className="mode-choice" key={type} type="button" onClick={() => startAdd(type)}>
              <span className="mode-row">{widgetRegistry[type].label}</span>
              <small>{widgetRegistry[type].description}</small>
            </button>
          ))}
          <button className="data-button" type="button" onClick={() => setPicking(false)}>
            <span>cancel</span>
          </button>
        </div>
      ) : (
        <button className="data-button" type="button" onClick={() => setPicking(true)}>
          <Plus aria-hidden="true" size={14} strokeWidth={1.8} />
          <span>add widget</span>
        </button>
      )}
      <p>widgets also live as files in your notes folder (widgets/*.json) — agents can add and edit them.</p>
    </section>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: WidgetField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (field.kind === "select") {
    return (
      <select className="widget-field-input" value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}>
        {field.options?.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.kind === "number") {
    return (
      <input
        className="widget-field-input"
        type="number"
        min={field.min}
        max={field.max}
        value={typeof value === "number" ? value : ""}
        onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
      />
    );
  }
  return (
    <input
      className="widget-field-input"
      type="text"
      placeholder={field.placeholder}
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

// slugified title, falling back to the type; suffixed until unique
function uniqueWidgetId(title: string, type: WidgetType, widgets: WidgetRow[]): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const slug = WIDGET_ID_PATTERN.test(base) ? base : type;
  let candidate = slug;
  let suffix = 2;
  while (widgets.some((w) => w.id === candidate)) candidate = `${slug}-${suffix++}`;
  return candidate;
}
