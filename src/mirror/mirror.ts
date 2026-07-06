import { db, type DayRow, type PanelRow } from "../db/db";
import { hasDayContent } from "../db/days";
import { getPanel } from "../db/panels";

const MIRROR_DIR_ID = "mirrorDir";
const encoder = new TextEncoder();

export type MirrorPermission = "granted" | "denied" | "prompt";
export type MirrorStatus = "off" | "connected" | "reconnect" | "unsupported" | "error";

export interface FileSystemWritableFileStreamLike {
  write(data: BlobPart): Promise<void>;
  close(): Promise<void>;
}

export interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableFileStreamLike>;
  getFile?(): Promise<{ text(): Promise<string> }>;
}

export interface FileSystemDirectoryHandleLike {
  name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandleLike>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandleLike>;
  removeEntry?(name: string): Promise<void>;
  values?(): AsyncIterable<{ kind: "file" | "directory"; name: string }>;
  queryPermission?(descriptor?: { mode: "readwrite" }): Promise<MirrorPermission>;
  requestPermission?(descriptor?: { mode: "readwrite" }): Promise<MirrorPermission>;
}

interface WindowWithDirectoryPicker extends Window {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandleLike>;
}

export function isMirrorSupported(): boolean {
  return typeof window !== "undefined" && typeof (window as WindowWithDirectoryPicker).showDirectoryPicker === "function";
}

export async function pickMirrorDirectory(): Promise<FileSystemDirectoryHandleLike> {
  const picker = (window as WindowWithDirectoryPicker).showDirectoryPicker;
  if (!picker) throw new Error("Folder mirror is not available in this browser.");

  const handle = await picker({ mode: "readwrite" });
  await storeMirrorDirectory(handle);
  return handle;
}

export async function storeMirrorDirectory(handle: FileSystemDirectoryHandleLike): Promise<void> {
  await db.meta.put({ id: MIRROR_DIR_ID, value: handle });
}

export async function getMirrorDirectory(): Promise<FileSystemDirectoryHandleLike | null> {
  const row = await db.meta.get(MIRROR_DIR_ID);
  return isDirectoryHandle(row?.value) ? row.value : null;
}

export async function queryMirrorStatus(handle: FileSystemDirectoryHandleLike | null): Promise<MirrorStatus> {
  if (!isMirrorSupported()) return "unsupported";
  if (!handle) return "off";

  try {
    const permission = await queryMirrorPermission(handle);
    return permission === "granted" ? "connected" : "reconnect";
  } catch (error) {
    console.warn("Tab Pad mirror permission check failed", error);
    return "error";
  }
}

export async function queryMirrorPermission(handle: FileSystemDirectoryHandleLike): Promise<MirrorPermission> {
  return handle.queryPermission?.({ mode: "readwrite" }) ?? "granted";
}

export async function requestMirrorPermission(handle: FileSystemDirectoryHandleLike): Promise<MirrorPermission> {
  return handle.requestPermission?.({ mode: "readwrite" }) ?? "granted";
}

export async function writeFullMirror(handle: FileSystemDirectoryHandleLike): Promise<void> {
  const [days, scratchpad] = await Promise.all([db.days.toArray(), getPanel("scratchpad")]);

  for (const day of days.filter((row) => hasDayContent(row.main, row.margin))) {
    await writeDayMirror(handle, day);
  }

  await writePanelMirror(handle, scratchpad);
}

export async function writeDayMirror(handle: FileSystemDirectoryHandleLike, day: DayRow): Promise<void> {
  // freshness guard: never overwrite a disk file that has newer, different
  // content than the app's copy — sync will import it instead. also never
  // create files just to hold empty content.
  const mainDisk = await readDiskFile(handle, `${day.date}.md`);
  if (mainDisk ? mainDisk.text !== day.main && mainDisk.lastModified <= (day.mainUpdatedAt ?? day.updatedAt) : day.main !== "") {
    await writeTextFile(handle, [`${day.date}.md`], day.main);
  }

  let marginsDir: FileSystemDirectoryHandleLike | null = null;
  try {
    marginsDir = await handle.getDirectoryHandle("margins");
  } catch {
    marginsDir = null;
  }
  const marginDisk = marginsDir ? await readDiskFile(marginsDir, `${day.date}.md`) : null;
  if (marginDisk ? marginDisk.text !== day.margin && marginDisk.lastModified <= (day.marginUpdatedAt ?? day.updatedAt) : day.margin !== "") {
    await writeTextFile(handle, ["margins", `${day.date}.md`], day.margin);
  }
}

export async function writePanelMirror(handle: FileSystemDirectoryHandleLike, panel: PanelRow): Promise<void> {
  if (panel.id !== "scratchpad") return;
  const disk = await readDiskFile(handle, "scratchpad.md");
  if (!disk && panel.content === "") return;
  if (disk && disk.text !== panel.content && disk.lastModified > panel.updatedAt) return;
  if (disk?.text === panel.content) return;
  await writeTextFile(handle, ["scratchpad.md"], panel.content);
}

export interface AgentSurfaces {
  margins: boolean;
  scratchpad: boolean;
}

interface DiskFile {
  text: string;
  lastModified: number;
}

async function readDiskFile(dir: FileSystemDirectoryHandleLike, name: string): Promise<DiskFile | null> {
  try {
    const handle = await dir.getFileHandle(name);
    if (!handle.getFile) return null;
    const file = (await handle.getFile()) as { text(): Promise<string>; lastModified?: number };
    return { text: await file.text(), lastModified: file.lastModified ?? 0 };
  } catch {
    return null;
  }
}

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.md$/;

// two-way sync over the SAME files humans and agents share.
// per file, last write wins: a disk edit newer than the in-app edit is
// imported; otherwise the app's version is written back out.
// `mtimes` is an optional cache so frequent polls skip unchanged files
// without reading their contents.
export interface SyncSkip {
  day?: string | null;
  margin?: string | null;
  scratchpad?: boolean;
}

export async function syncWithDisk(
  handle: FileSystemDirectoryHandleLike,
  mtimes?: Map<string, number>,
  skip?: SyncSkip,
): Promise<number> {
  if (!handle.values) return 0;
  let imported = 0;

  const reconcileDay = async (date: string, field: "main" | "margin", disk: DiskFile) => {
    // never reconcile the field the user is typing in — neither import over
    // their cursor nor push their stale copy over the file; defer entirely
    if ((field === "main" && skip?.day === date) || (field === "margin" && skip?.margin === date)) {
      return;
    }
    const row = await db.days.get(date);
    const current = (field === "main" ? row?.main : row?.margin) ?? "";
    if (disk.text === current) return;
    // clamp file mtimes to now — a future mtime (clock skew, cloud folders)
    // must not win every merge forever
    const diskStamp = Math.min(disk.lastModified, Date.now());
    // judge each field by its OWN edit time — a margin import must not make
    // the note file look stale (and vice versa)
    const fieldStamp = row ? (field === "main" ? row.mainUpdatedAt : row.marginUpdatedAt) ?? row.updatedAt : 0;
    if (!row || diskStamp > fieldStamp) {
      const next: DayRow = {
        date,
        main: field === "main" ? disk.text : row?.main ?? "",
        margin: field === "margin" ? disk.text : row?.margin ?? "",
        createdAt: row?.createdAt ?? diskStamp,
        updatedAt: Math.max(row?.updatedAt ?? 0, diskStamp),
        mainUpdatedAt: field === "main" ? diskStamp : row?.mainUpdatedAt ?? row?.updatedAt,
        marginUpdatedAt: field === "margin" ? diskStamp : row?.marginUpdatedAt ?? row?.updatedAt,
      };
      if (hasDayContent(next.main, next.margin) || row) {
        await db.days.put(next);
        imported += 1;
      }
    } else {
      // the app's copy of this field is newer — push it back to disk
      await writeTextFile(handle, field === "main" ? [`${date}.md`] : ["margins", `${date}.md`], current);
    }
  };

  // note: the cache is only updated AFTER a change is fully applied, so a
  // failed reconcile is retried on the next pass instead of lost
  const readIfChanged = async (dir: FileSystemDirectoryHandleLike, name: string, cacheKey: string) => {
    const disk = await readDiskFile(dir, name);
    if (!disk) return null;
    if (mtimes && mtimes.get(cacheKey) === disk.lastModified) return null;
    return disk;
  };

  for await (const entry of handle.values()) {
    if (entry.kind === "file") {
      const match = DAY_FILE.exec(entry.name);
      if (match) {
        const disk = await readIfChanged(handle, entry.name, entry.name);
        if (disk) {
          const skipped = skip?.day === match[1];
          await reconcileDay(match[1], "main", disk);
          if (!skipped) mtimes?.set(entry.name, disk.lastModified);
        }
      } else if (entry.name === "scratchpad.md") {
        if (skip?.scratchpad) continue;
        const disk = await readIfChanged(handle, entry.name, entry.name);
        if (disk) {
          const panel = await getPanel("scratchpad");
          if (disk.text !== panel.content) {
            const diskStamp = Math.min(disk.lastModified, Date.now());
            if (diskStamp > panel.updatedAt) {
              await db.panels.put({ id: "scratchpad", content: disk.text, updatedAt: diskStamp });
              imported += 1;
            } else {
              await writeTextFile(handle, ["scratchpad.md"], panel.content);
            }
          }
          mtimes?.set(entry.name, disk.lastModified);
        }
      }
    } else if (entry.kind === "directory" && entry.name === "margins") {
      const margins = await handle.getDirectoryHandle("margins");
      if (!margins.values) continue;
      for await (const marginEntry of margins.values()) {
        if (marginEntry.kind !== "file") continue;
        const match = DAY_FILE.exec(marginEntry.name);
        if (!match) continue;
        const disk = await readIfChanged(margins, marginEntry.name, `margins/${marginEntry.name}`);
        if (disk) {
          const skipped = skip?.margin === match[1];
          await reconcileDay(match[1], "margin", disk);
          if (!skipped) mtimes?.set(`margins/${marginEntry.name}`, disk.lastModified);
        }
      }
    }
  }

  return imported;
}

// remove every note file from the folder — used by "erase all notes" so the
// files can't resurrect the notes on the next sync
export async function eraseMirrorFiles(handle: FileSystemDirectoryHandleLike): Promise<void> {
  if (!handle.values) return;
  const names: string[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind === "file" && (DAY_FILE.test(entry.name) || entry.name === "scratchpad.md")) {
      names.push(entry.name);
    }
  }
  for (const name of names) {
    await handle.removeEntry?.(name);
  }
  try {
    const margins = await handle.getDirectoryHandle("margins");
    if (margins.values) {
      const marginNames: string[] = [];
      for await (const entry of margins.values()) {
        if (entry.kind === "file" && DAY_FILE.test(entry.name)) marginNames.push(entry.name);
      }
      for (const name of marginNames) {
        await margins.removeEntry?.(name);
      }
    }
  } catch {
    // no margins dir — nothing to erase
  }
}

// tabpad.json + AGENTS.md make the mirror folder self-describing for agents:
// what exists, what's enabled, and exactly how to add notes safely
export async function writeAgentFiles(
  handle: FileSystemDirectoryHandleLike,
  surfaces: AgentSurfaces,
  todayKey: string,
): Promise<void> {
  const manifest = {
    app: "tab pad",
    docs: "AGENTS.md",
    today: todayKey,
    dateFormat: "YYYY-MM-DD",
    surfaces: {
      days: true,
      margins: surfaces.margins,
      scratchpad: surfaces.scratchpad,
    },
    files: {
      day: "<YYYY-MM-DD>.md",
      margin: "margins/<YYYY-MM-DD>.md",
      scratchpad: "scratchpad.md",
    },
    write: {
      mode: "direct",
      pickup:
        "live — within a few seconds while the app is open; deferred while the human's cursor is inside that specific note; otherwise on next new-tab open",
      conflict: "last write wins per file (file mtime vs in-app edit time)",
      todayNote: "the 'today' field is from the last sync and can be stale — compute today's date from the system clock",
    },
  };
  await writeTextFile(handle, ["tabpad.json"], `${JSON.stringify(manifest, null, 2)}\n`);
  await writeTextFile(handle, ["AGENTS.md"], agentsGuide(surfaces));
}

function agentsGuide(surfaces: AgentSurfaces): string {
  return `# Tab Pad — agent guide

This folder IS a human's Tab Pad daily notepad (a Chrome new-tab extension).
Humans and agents share the same files. Check \`tabpad.json\` for today's date
and which surfaces are currently visible in the app.

## The files

- \`<YYYY-MM-DD>.md\` — that day's note (create the file to write to a new date, past or future)
- \`margins/<YYYY-MM-DD>.md\` — that day's side notes${surfaces.margins ? "" : " (currently hidden in the app, but still synced)"}
- \`scratchpad.md\` — the persistent scratchpad${surfaces.scratchpad ? "" : " (currently hidden in the app, but still synced)"}

## Editing

Edit the files directly — your changes appear in the app live, within a few
seconds while a tab is open (and otherwise on the next new-tab open).

- **Last write wins, per file.** If the human edited a note in the app more
  recently than your file write, your version is overwritten. Re-read a file
  just before writing it, and avoid editing a note the human is actively
  typing in right now.
- **Focused notes are deferred.** While the human's cursor sits in a note,
  your edit to that note's file waits (and may lose to their next keystroke).
  Prefer writing to OTHER days — especially not today's note if they're using it.
- **Deleting a file does not delete the note** — the app will recreate it.
  To clear a note, write the file with empty content instead.
- **Compute today's date from the system clock**, not from tabpad.json (its
  \`today\` value is from the last sync and can be stale).
- Prefer appending lines over rewriting whole files.
- Todos go on the day they should happen, as \`- [ ] task\` lines.
- Reference material and running lists belong in \`scratchpad.md\`.
- Sign what you add (e.g. \`— added by <agent name>\`) so the human knows the source.
- Keep entries short; the human reads these on every new tab.

## Markdown that renders in the app

- \`- [ ] task\` / \`- [x] done\` — checkboxes the human can tick
- \`# heading\` (through \`####\`), \`- bullet\`, \`> quote\`, \`---\` divider
- \`**bold**\`, \`*italic*\`, \`~~strikethrough~~\`, \`\` \`code\` \`\`, \`[label](url)\`
`;
}

export function isMirrorPermissionError(error: unknown): boolean {
  return error instanceof DOMException && ["NotAllowedError", "SecurityError", "AbortError"].includes(error.name);
}

async function writeTextFile(
  directory: FileSystemDirectoryHandleLike,
  pathSegments: string[],
  content: string,
): Promise<void> {
  const filename = pathSegments.at(-1);
  if (!filename) return;

  let target = directory;
  for (const segment of pathSegments.slice(0, -1)) {
    target = await target.getDirectoryHandle(segment, { create: true });
  }

  const file = await target.getFileHandle(filename, { create: true });
  const writable = await file.createWritable();
  await writable.write(encoder.encode(content));
  await writable.close();
}

function isDirectoryHandle(value: unknown): value is FileSystemDirectoryHandleLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "getFileHandle" in value &&
    "getDirectoryHandle" in value
  );
}
