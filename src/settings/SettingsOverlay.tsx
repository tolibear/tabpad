import { Bot, Check, Copy, Download, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import type { Settings, WidgetRow } from "../db/db";
import { accentColors, type AccentColor, type ThemePreference } from "../lib/theme";
import type { MirrorStatus } from "../mirror/mirror";
import { WidgetSettings } from "./WidgetSettings";

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
  privacyMode: boolean;
  widgets: WidgetRow[];
  onWidgetToggle: (id: string, enabled: boolean) => void;
  onWidgetMove: (id: string, direction: -1 | 1) => void;
  onWidgetDelete: (id: string) => void;
  onWidgetSave: (row: WidgetRow) => void;
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
  privacyMode,
  widgets,
  onWidgetToggle,
  onWidgetMove,
  onWidgetDelete,
  onWidgetSave,
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
  const [promptCopied, setPromptCopied] = useState(false);

  if (!open) return null;

  const copyAgentPrompt = () => {
    void navigator.clipboard
      .writeText(buildAgentPrompt(mirrorName))
      .then(() => {
        setPromptCopied(true);
        window.setTimeout(() => setPromptCopied(false), 2500);
      })
      .catch(() => {
        // clipboard blocked (e.g. enterprise policy) — offer manual copy
        window.prompt("copy the prompt manually:", buildAgentPrompt(mirrorName));
      });
  };

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

        {privacyMode ? (
          <section className="settings-section" aria-label="sidebar">
            <h3>sidebar</h3>
            <p className="data-message">unlock privacy mode to edit the sidebar.</p>
          </section>
        ) : (
          <WidgetSettings
            widgets={widgets}
            onToggle={onWidgetToggle}
            onMove={onWidgetMove}
            onDelete={onWidgetDelete}
            onSave={onWidgetSave}
          />
        )}

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
            <div><dt>⌘R / Ctrl+R</dt><dd>refresh — back to today</dd></div>
          </dl>
          <a className="guide-link" href="https://tabpad.app/markdown.html?ref=app" target="_blank" rel="noreferrer">
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
            made to the files show up here live. see AGENTS.md inside the folder.
          </p>
          {mirrorStatus === "unsupported" ? (
            <p className="data-message">folder sync isn't supported in this browser — notes still save locally.</p>
          ) : (
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
          )}
        </section>

        <section className="settings-section" aria-label="your agent (experimental)">
          <h3>
            your agent <span className="experimental-tag">experimental</span>
          </h3>
          <p>
            let claude code (or any coding agent) read and write your days. paste the prompt into your agent once —
            it finds your notes folder, installs a tab pad skill (so "remind me thursday" just works in every future
            session), and proves the connection by writing to today's note while you watch.
          </p>
          {mirrorStatus === "connected" ? (
            <div className="data-actions">
              <button className="data-button agent-connect" type="button" onClick={copyAgentPrompt}>
                {promptCopied ? (
                  <Check aria-hidden="true" size={14} strokeWidth={1.8} />
                ) : (
                  <Bot aria-hidden="true" size={14} strokeWidth={1.8} />
                )}
                <span>{promptCopied ? "copied — paste it into your agent" : "copy the connect prompt"}</span>
              </button>
            </div>
          ) : (
            <p className="data-message">connect a notes folder above first — that's what your agent reads and writes.</p>
          )}
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
        <p className="settings-footer settings-credit">
          <a href="https://tabpad.app?ref=app" target="_blank" rel="noreferrer">
            tabpad.app
          </a>
          {" · built by "}
          <a href="https://x.com/tolibear_" target="_blank" rel="noreferrer">
            toli
          </a>
        </p>
      </aside>
    </div>
  );
}

function buildAgentPrompt(folderName: string): string {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return `Install my Tab Pad skill. Tab Pad is my new-tab daily notepad; it syncs a folder of plain markdown files on this computer, and you can read and write them directly — changes appear live in my open tab within seconds.

1. FIND my notes folder. It is named "${folderName}" and contains a file called tabpad.json. Locate it, e.g.:
   mdfind -name tabpad.json    (or: find ~ -maxdepth 5 -name tabpad.json 2>/dev/null)
   Confirm the folder name matches "${folderName}".

2. INSTALL the skill. Create the file ~/.claude/skills/tabpad/SKILL.md (or your agent's equivalent skills location) with EXACTLY the content between the ==== markers, replacing <NOTES_FOLDER_PATH> with the absolute path you found. If you don't support skill files, add the same content to your persistent instructions (CLAUDE.md, memory, etc.) instead.

====
---
name: tabpad
description: Read and write the user's Tab Pad daily notepad — a new-tab notes app backed by a folder of markdown files. Use when the user mentions tab pad or their daily notes, asks to add a todo or reminder for any day, wants something written down or noted, or asks what is on their schedule, days, or scratchpad.
---

# Tab Pad — the user's daily notepad

Notes folder: \`<NOTES_FOLDER_PATH>\` (contains tabpad.json — verify it exists; if moved, relocate via \`mdfind -name tabpad.json\`)

## Layout
- \`YYYY-MM-DD.md\` — one file per day; create the file to write to any date, past or future
- \`scratchpad.md\` — persistent notes and running lists
- \`margins/YYYY-MM-DD.md\` — per-day side notes
- \`tabpad.json\` — which surfaces are enabled (its \`today\` can be stale — compute today from the system clock)
- \`AGENTS.md\` — the full contract, read it if unsure

## Rules
- Edit files directly; the user sees changes live in their open tab within seconds
- If the user's cursor is inside a note, edits to that note's file are deferred and may lose to their typing — prefer other days
- Prefer APPENDING lines; re-read a file immediately before writing it (last write wins per file)
- Never rewrite or delete the user's existing text unless asked; deleting a file does not delete the note — write it empty instead
- Compute today's date from the system clock, not tabpad.json
- Sign what you add: \`— added by <your name>\`

## Conventions
- Todos and reminders → \`- [ ] task\` lines on the day they should happen (dates from the system clock)
- Reference material and running lists → scratchpad.md
- Keep entries short — the user reads these on every new tab
- Markdown that renders: \`- [ ]\` checkboxes, \`#\` headings, \`-\` bullets, \`>\` quotes, \`---\` dividers, **bold**, *italic*, \`code\`, [links](url)
====

3. PROVE it worked. Using the skill, append this line to today's file (${todayKey}.md):
   - [x] agent connected — <your name>
   I'll watch it appear in my tab.`;
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
