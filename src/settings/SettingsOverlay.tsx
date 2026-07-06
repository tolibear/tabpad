import { Download, Upload, X } from "lucide-react";
import { useRef } from "react";
import type { Settings } from "../db/db";
import { accentColors, type AccentColor, type ThemePreference } from "../lib/theme";
import type { MirrorStatus } from "../mirror/mirror";

const themeOptions: ThemePreference[] = ["system", "light", "dark"];
const editorSizes: Settings["editorSize"][] = ["sm", "md", "lg"];
const fontOptions: Array<{ value: Settings["font"]; label: string }> = [
  { value: "sans", label: "sans serif" },
  { value: "serif", label: "serif" },
  { value: "mono", label: "monospace" },
];
const layoutToggles: Array<{
  key: "scratchpad" | "margins";
  label: string;
  description: string;
}> = [
  { key: "scratchpad", label: "scratchpad", description: "one persistent note in a right panel" },
  { key: "margins", label: "per-day margins", description: "every day gets its own side notes" },
];

interface SettingsOverlayProps {
  open: boolean;
  theme: ThemePreference;
  accent: AccentColor;
  scratchpad: boolean;
  margins: boolean;
  weekStartsOn: Settings["weekStartsOn"];
  editorSize: Settings["editorSize"];
  font: Settings["font"];
  mirrorStatus: MirrorStatus;
  mirrorName: string;
  dataMessage: string;
  onClose: () => void;
  onThemeChange: (theme: ThemePreference) => void;
  onAccentChange: (accent: AccentColor) => void;
  onScratchpadChange: (on: boolean) => void;
  onMarginsChange: (on: boolean) => void;
  onWeekStartsOnChange: (day: Settings["weekStartsOn"]) => void;
  onEditorSizeChange: (size: Settings["editorSize"]) => void;
  onFontChange: (font: Settings["font"]) => void;
  onEnableMirror: () => void;
  onReconnectMirror: () => void;
  onExport: () => void;
  onImport: (file: File | undefined) => void;
  onEraseAll: () => void;
}

export function SettingsOverlay({
  open,
  theme,
  accent,
  scratchpad,
  margins,
  weekStartsOn,
  editorSize,
  font,
  mirrorStatus,
  mirrorName,
  dataMessage,
  onClose,
  onThemeChange,
  onAccentChange,
  onScratchpadChange,
  onMarginsChange,
  onWeekStartsOnChange,
  onEditorSizeChange,
  onFontChange,
  onEnableMirror,
  onReconnectMirror,
  onExport,
  onImport,
  onEraseAll,
}: SettingsOverlayProps) {
  const importInputRef = useRef<HTMLInputElement | null>(null);

  if (!open) return null;

  return (
    <div
      className="settings-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="settings-sheet" aria-label="settings">
        <header className="settings-head">
          <h2>settings</h2>
          <button className="icon-button" type="button" aria-label="close" onClick={onClose}>
            <X aria-hidden="true" size={17} strokeWidth={1.8} />
          </button>
        </header>

        <section className="settings-section" aria-label="appearance">
          <h3>appearance</h3>
          <SegmentedControl
            label="theme"
            value={theme}
            options={themeOptions.map((option) => ({ value: option, label: option }))}
            onChange={(value) => onThemeChange(value as ThemePreference)}
          />
          <div className="settings-control">
            <span>color</span>
            <div className="accent-swatches">
              {accentColors.map((option) => (
                <button
                  className={option === accent ? "accent-swatch selected" : "accent-swatch"}
                  key={option}
                  type="button"
                  aria-label={option}
                  aria-pressed={option === accent}
                  data-accent={option}
                  onClick={() => onAccentChange(option)}
                />
              ))}
            </div>
          </div>
          <SegmentedControl
            label="text"
            value={editorSize}
            options={editorSizes.map((size) => ({ value: size, label: size }))}
            onChange={(value) => onEditorSizeChange(value as Settings["editorSize"])}
          />
          <SegmentedControl
            label="font"
            value={font}
            options={fontOptions}
            onChange={(value) => onFontChange(value as Settings["font"])}
          />
        </section>

        <section className="settings-section" aria-label="layout">
          <h3>layout</h3>
          <div className="mode-list">
            {layoutToggles.map((toggle) => {
              const on = toggle.key === "scratchpad" ? scratchpad : margins;
              const change = toggle.key === "scratchpad" ? onScratchpadChange : onMarginsChange;
              return (
                <button
                  className={on ? "mode-choice selected" : "mode-choice"}
                  key={toggle.key}
                  type="button"
                  role="switch"
                  aria-checked={on}
                  onClick={() => change(!on)}
                >
                  <span className="mode-row">
                    {toggle.label}
                    <span className={on ? "mode-switch on" : "mode-switch"} aria-hidden="true" />
                  </span>
                  <small>{toggle.description}</small>
                </button>
              );
            })}
          </div>
        </section>

        <section className="settings-section" aria-label="calendar">
          <h3>calendar</h3>
          <SegmentedControl
            label="week"
            value={String(weekStartsOn)}
            options={[
              { value: "0", label: "sunday" },
              { value: "1", label: "monday" },
            ]}
            onChange={(value) => onWeekStartsOnChange(value === "1" ? 1 : 0)}
          />
        </section>

        <section className="settings-section" aria-label="shortcuts">
          <h3>shortcuts</h3>
          <dl className="shortcut-list">
            <div><dt>⌘K / Ctrl+K</dt><dd>jump to any date ("friday", "nov 12"...)</dd></div>
            <div><dt>Shift+↑ / Shift+↓</dt><dd>next / previous day (outside a note)</dd></div>
            <div><dt>Tab / Shift+Tab</dt><dd>indent / outdent a list item</dd></div>
            <div><dt>⌘B / ⌘I</dt><dd>bold / italic</dd></div>
            <div><dt>[] + space</dt><dd>make a checkbox</dd></div>
          </dl>
          <a className="guide-link" href="https://tabpad.app/markdown.html" target="_blank" rel="noreferrer">
            full markdown guide ↗
          </a>
        </section>

        <section className="settings-section" aria-label="notes folder">
          <h3>notes folder</h3>
          <div className="storage-row">
            <span>{mirrorName || "no folder chosen yet"}</span>
            <strong>{mirrorStatusLabel(mirrorStatus)}</strong>
          </div>
          <p>
            your days live in this folder as plain .md files — shared with backups, other apps, and ai agents. edits
            made to the files show up here on your next new tab. see AGENTS.md inside the folder.
          </p>
          <div className="mirror-actions">
            <button className="data-button" type="button" onClick={onEnableMirror}>
              <span>{mirrorName ? "change folder" : "choose folder"}</span>
            </button>
            {mirrorStatus === "reconnect" || mirrorStatus === "error" ? (
              <button className="data-button" type="button" onClick={onReconnectMirror}>
                <span>reconnect</span>
              </button>
            ) : null}
          </div>
        </section>

        <section className="settings-section" aria-label="data">
          <h3>data</h3>
          <div className="data-actions">
            <button className="data-button" type="button" onClick={onExport}>
              <Download aria-hidden="true" size={14} strokeWidth={1.8} />
              <span>export</span>
            </button>
            <button className="data-button" type="button" onClick={() => importInputRef.current?.click()}>
              <Upload aria-hidden="true" size={14} strokeWidth={1.8} />
              <span>import</span>
            </button>
            <input
              ref={importInputRef}
              className="file-input"
              type="file"
              accept="application/json"
              onChange={(event) => {
                onImport(event.currentTarget.files?.[0]);
                // reset so picking the same file again re-triggers onChange
                event.currentTarget.value = "";
              }}
            />
            <button className="data-button danger" type="button" onClick={onEraseAll}>
              <span>erase all notes</span>
            </button>
            {dataMessage ? <p className="data-message">{dataMessage}</p> : null}
          </div>
        </section>

        <p className="settings-footer">
          everything lives in this browser profile. enable the folder mirror or export periodically if that worries you.
        </p>
      </aside>
    </div>
  );
}

function mirrorStatusLabel(status: MirrorStatus): string {
  if (status === "off") return "not set up";
  if (status === "connected") return "connected";
  if (status === "unsupported") return "unavailable";
  if (status === "error") return "needs attention";
  return "reconnect needed";
}

interface SegmentedControlProps {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

function SegmentedControl({ label, value, options, onChange }: SegmentedControlProps) {
  return (
    <div className="settings-control">
      <span>{label}</span>
      <div className="settings-segmented">
        {options.map((option) => (
          <button
            className={option.value === value ? "settings-segment selected" : "settings-segment"}
            key={option.value}
            type="button"
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
