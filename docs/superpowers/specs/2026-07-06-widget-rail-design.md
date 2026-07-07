# Widget Rail — design spec

**Date:** 2026-07-06
**Status:** implemented

## Summary

Turn the left rail from a hardcoded stack (calendar + noted days) into a
**declarative widget system**. Built-in widgets and user-created widgets share
one shape: a small JSON record naming a renderer type and its config. Widgets
live in Tab Pad's local database, are managed from settings (toggle, reorder,
add, edit, delete), and mirror to `widgets/*.json` files in the connected
notes folder — the same humans-and-agents-share-files pattern as notes.

**No arbitrary code.** Tab Pad ships every renderer and data source. A widget
file says *what to show*, never *how*. This is a hard requirement: the
extension's CSP is `script-src 'self'` and Chrome Web Store policy bans
remote code. It is also the feature: an agent (or a future community gallery)
can hand a user a widget as a plain JSON file that provably cannot exfiltrate
notes.

The organizing UX borrows Obsidian's two-tier layout: **core widgets**
(shipped, toggleable, undeletable) and **custom widgets** (user/agent
authored). A community gallery — a GitHub-hosted index of shareable widget
JSON — is an explicit future phase, not built now; the file format is designed
so it needs nothing new.

## Goals

- Calendar and noted days become widgets — same registry, same record shape,
  toggleable and reorderable, no longer hardcoded in `Rail.tsx`.
- Users can add custom widgets from a small set of shipped renderer types.
- Widget definitions mirror to `widgets/<id>.json` with two-way sync
  (last-write-wins per file), so agents can create and edit widgets.
- `AGENTS.md` / `tabpad.json` document the widget format for agents.
- Everything keeps working with no folder connected (DB is the source of
  truth; files are a mirror, exactly like notes).

## Non-goals (v1)

- Sandboxed/JS widgets, remote code of any kind.
- Community gallery / in-app widget browser (future phase; format-compatible).
- Widgets outside the left rail (right panel, inline in days).
- Rich in-app config editing beyond a simple per-type form.
- Drag-and-drop reordering (up/down buttons suffice).

## Data model

New Dexie table `widgets` (DB `version(2)`, additive — no row migration):

```ts
interface WidgetRow {
  id: string;          // slug [a-z0-9-]{1,40}, doubles as the mirror filename
  type: WidgetType;    // "calendar" | "day-list" | "counter" | "task-rollup" | "text"
  title: string;       // section heading; "" hides the heading
  config: Record<string, unknown>;  // validated per type, unknown keys ignored
  order: number;       // rail position, ascending
  enabled: boolean;
  updatedAt: number;   // drives file-sync last-write-wins, clamped like notes
}
```

Core widgets are ordinary rows with reserved ids `calendar` and `noted-days`,
seeded at load when missing (`ensureDefaultWidgets()`), matching today's rail:
calendar first, noted days second, both enabled. Core rows cannot be deleted
or have their `type` changed; they can be disabled, retitled, reordered, and
(for noted-days) reconfigured. Deleting their mirror file recreates it —
identical semantics to note files.

## Renderer types and configs

All config fields optional with defaults. Validation is a hand-rolled
sanitizer per type (same style as `sanitizeSettings`), no new dependencies.
Invalid values fall back to defaults; a malformed widget (unknown `type`,
unparseable file) renders as a small inline error card in the rail naming the
widget and the problem, so authors get feedback instead of silence.

| type | what it renders | config |
|---|---|---|
| `calendar` | the existing mini month calendar | — (weekStartsOn stays a global setting) |
| `day-list` | rows of noted days: date + first-line excerpt, click jumps, active-day highlight | `limit` (1–200, default 50), `order` ("newest" \| "oldest", default "newest") |
| `counter` | one number + label line | `source` (see data sources), `format` (string with `{n}`, default `"{n}"`) |
| `task-rollup` | open `- [ ]` lines from recent days, grouped by day, click jumps to that day | `days` (1–90, default 14), `limit` (1–100, default 20) |
| `text` | static plain-text lines (no markdown in v1) | `content` (string, required) |

"Noted days" is exactly `{ type: "day-list", title: "noted days" }` with
defaults — proof the built-ins and custom widgets are the same thing.

## Data sources

`src/widgets/sources.ts`: pure functions over data the app already holds in
memory — `{ today, todayKey, todayText, contentDays }`. Read-only by
construction; widgets never touch Dexie.

- `noted-days` — count of days with content
- `streak` — consecutive noted days ending today or yesterday
- `open-tasks` — count of unchecked `- [ ]` lines across all days
- `words-today` — word count of today's note
- `words-total` — word count across all notes

A `useWidgetData` hook memoizes derived data per render pass so five widgets
don't re-parse all days five times. Checkbox parsing reuses the same regex
family already used by `firstLineExcerpt` / the editor (`- [ ]` / `- [x]`).

## Rendering architecture

- `src/widgets/registry.ts` — `WidgetType → { label, description, component,
  defaultConfig, sanitizeConfig, fields }`. `fields` is a tiny declarative
  form descriptor (text / number / select) that drives the generic add/edit
  form in settings — one form component, no per-type forms.
- `src/widgets/WidgetShell.tsx` — heading + body wrapper + error card for
  invalid widgets.
- `Rail.tsx` — keeps the brand mark and bottom reconnect chips; the middle
  becomes `widgets.filter(enabled).sort(order).map(...)`. `MiniCalendar` and
  `NotedDays` move to `src/widgets/` as the `calendar` and `day-list`
  renderer components (logic unchanged).
- Interactions available to widgets: `onJumpToDate` only (v1).
- Privacy mode: `day-list` excerpts and `task-rollup` lines scramble via the
  existing `scrambleText`, like noted days today.

## Persistence, broadcast, sync

- `src/db/widgets.ts` — list/save/delete with the same serialized-save-chain
  pattern as `settings.ts`; `saveWidget` stamps `updatedAt`.
- Broadcast: new `{ type: "widgets" }` message on the existing channel; other
  tabs reload widget rows (and the folder-holding tab queues mirror writes).
- Mirror: each row writes `widgets/<id>.json` — pretty JSON of
  `{ type, title, enabled, order, config }` (id comes from the filename).
  Written through the existing `writeTextFile`, so overwrites of external
  edits get `.tabpad-trash` copies for free.
- `syncWithDisk` gains a `widgets/` directory pass mirroring the `margins/`
  pass: mtime cache, last-write-wins per file (`file mtime` vs
  `row.updatedAt`, both clamped to now), app-newer pushes back to disk.
  Unparseable or invalid files are **not imported and not overwritten**
  (the author may be mid-edit); the app shows the error card.
- Deleting a widget in settings removes the row and the mirror file (trash
  copy first). Deleting the *file* does not delete the widget — the app
  recreates it, same as notes; `AGENTS.md` documents "to remove a widget,
  set `enabled: false`" for agents.
- Export/import: `TabPadExport` gains `widgets: WidgetRow[]`
  (schemaVersion stays 1 — old builds ignore the extra key, matching the
  existing best-effort forward-compat comment); import merges by
  `updatedAt` like panels, timestamps clamped.
- "Erase all notes" leaves widgets alone (they aren't notes).

## Agent contract updates

- `tabpad.json`: `surfaces.widgets: true`, `files.widget:
  "widgets/<slug>.json"`.
- `AGENTS.md`: new section documenting the five types, their config fields,
  one full example, the reserved core ids, slug rules, and the
  disable-don't-delete rule.
- The settings "your agent" connect prompt/skill gets one line mentioning
  widgets.

## Settings UI

New "sidebar" section in `SettingsOverlay` (below "layout"):

- Ordered widget list: title (or type label), core/custom tag, enable
  switch (existing `mode-choice` styling), ↑/↓ reorder, edit, delete
  (custom only).
- "add widget" → type picker (label + one-line description from the
  registry) → generic form from `fields` → creates the row, broadcasts,
  mirrors.
- Edit opens the same form pre-filled.

This is the most cuttable scope: if it grows, v1 falls back to
manage-only (toggle/reorder/delete) in-app, with creation via
files/agents — flagged for the plan review.

## Error handling

- Unknown `type` / invalid file → inline error card in the rail (widget name
  + reason), never a crash; the rest of the rail renders.
- Config values out of range → clamped to defaults silently (matching
  settings behavior).
- Sync failures on widget files follow the existing failure/backoff path in
  `app.tsx`.

## Verification

- `npm run typecheck` and `npm run build` stay green.
- New `scripts/verify-widgets.mjs` + `verify-widgets-runtime.ts` following
  the established `verify-mN` pattern (esbuild bundle + fake-indexeddb):
  seeding, CRUD + updatedAt stamping, config sanitizers, source functions
  (streak, open-tasks parsing), file-sync reconcile in both directions,
  invalid-file rejection, export/import round-trip with widgets.
- Static assertions: Rail no longer imports MiniCalendar/NotedDays directly;
  AGENTS.md mentions widgets; broadcast type exists.
- Manual pass in the built extension: toggle/reorder/add/edit/delete,
  agent-file edit appears live, privacy scramble, no-folder mode.

## Future phase (documented, not built)

Community gallery: a public GitHub repo of widget JSON files + an in-app
browser that fetches the index (data, not code — store-compliant). Submission
by PR, Obsidian-style. Nothing in v1 blocks it; a gallery entry is exactly a
`widgets/<id>.json` payload.
