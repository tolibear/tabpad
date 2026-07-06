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
  if (!handle) return "reconnect";

  try {
    const permission = await queryMirrorPermission(handle);
    return permission === "granted" ? "connected" : "reconnect";
  } catch (error) {
    console.warn("Daybook mirror permission check failed", error);
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
  const [days, scratchpad, masterList] = await Promise.all([
    db.days.toArray(),
    getPanel("scratchpad"),
    getPanel("masterList"),
  ]);

  for (const day of days.filter((row) => hasDayContent(row.main, row.margin))) {
    await writeDayMirror(handle, day);
  }

  await writePanelMirror(handle, scratchpad);
  await writePanelMirror(handle, masterList);
}

export async function writeDayMirror(handle: FileSystemDirectoryHandleLike, day: DayRow): Promise<void> {
  // always write, including empty content — the mirror must not retain text
  // the user has deleted from the note
  await writeTextFile(handle, [`${day.date}.md`], day.main);

  await writeTextFile(handle, ["margins", `${day.date}.md`], day.margin);
}

export async function writePanelMirror(handle: FileSystemDirectoryHandleLike, panel: PanelRow): Promise<void> {
  const filename = panel.id === "scratchpad" ? "scratchpad.md" : "master-list.md";
  await writeTextFile(handle, [filename], panel.content);
}

export interface AgentSurfaces {
  margins: boolean;
  scratchpad: boolean;
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
    read: {
      day: "<YYYY-MM-DD>.md",
      margin: "margins/<YYYY-MM-DD>.md",
      scratchpad: "scratchpad.md",
    },
    write: {
      path: "inbox/",
      semantics: "append",
      day: "inbox/<YYYY-MM-DD>.md",
      margin: "inbox/<YYYY-MM-DD>.margin.md",
      scratchpad: "inbox/scratchpad.md",
    },
  };
  await writeTextFile(handle, ["tabpad.json"], `${JSON.stringify(manifest, null, 2)}\n`);
  await writeTextFile(handle, ["AGENTS.md"], agentsGuide(surfaces));
}

function agentsGuide(surfaces: AgentSurfaces): string {
  return `# Tab Pad — agent guide

This folder is the live mirror of a human's Tab Pad daily notepad (a Chrome
new-tab extension). Check \`tabpad.json\` for today's date and which surfaces
are currently enabled.

## Reading

- \`<YYYY-MM-DD>.md\` — that day's note
- \`margins/<YYYY-MM-DD>.md\` — that day's side notes${surfaces.margins ? "" : " (margins are currently disabled in the app, but the data is kept)"}
- \`scratchpad.md\` — the persistent scratchpad${surfaces.scratchpad ? "" : " (currently hidden in the app, but the data is kept)"}

Do NOT edit these files directly — Tab Pad overwrites them on every keystroke.

## Writing (the inbox)

To add content, create a file in \`inbox/\`. On the next new-tab open, Tab Pad
APPENDS its contents to the target and deletes the file (the deletion is your
receipt). Appending is the only write operation — you can never damage or
overwrite the human's existing notes.

- \`inbox/<YYYY-MM-DD>.md\` → appended to that day's note (any date, past or future)
- \`inbox/<YYYY-MM-DD>.margin.md\` → appended to that day's side notes
- \`inbox/scratchpad.md\` → appended to the scratchpad

## Markdown that renders in the app

- \`- [ ] task\` / \`- [x] done task\` — checkboxes the human can tick
- \`# heading\` (through \`####\`), \`- bullet\`, \`> quote\`, \`---\` divider
- \`**bold**\`, \`*italic*\`, \`~~strikethrough~~\`, \`\` \`code\` \`\`, \`[label](url)\`

## Conventions

- Todos for the human go on the day they should happen, as \`- [ ]\` tasks.
- Reference material and running lists belong in the scratchpad.
- Keep entries short; the human reads these on every new tab.
- Sign entries you add, e.g. \`— added by <agent name>\`, so the human knows the source.
`;
}

// consume inbox files: returns entries for the app to append, already removed
// from disk by the caller after a successful apply
export interface InboxEntry {
  name: string;
  text: string;
}

export async function readInbox(handle: FileSystemDirectoryHandleLike): Promise<InboxEntry[]> {
  let inbox: FileSystemDirectoryHandleLike;
  try {
    inbox = await handle.getDirectoryHandle("inbox");
  } catch {
    return [];
  }
  if (!inbox.values) return [];

  const entries: InboxEntry[] = [];
  for await (const item of inbox.values()) {
    if (item.kind !== "file" || !item.name.endsWith(".md")) continue;
    try {
      const file = await inbox.getFileHandle(item.name);
      const text = file.getFile ? await (await file.getFile()).text() : "";
      if (text.trim()) entries.push({ name: item.name, text });
    } catch {
      // unreadable file: leave it for the human to inspect
    }
  }
  return entries;
}

export async function removeInboxEntry(handle: FileSystemDirectoryHandleLike, name: string): Promise<void> {
  const inbox = await handle.getDirectoryHandle("inbox");
  await inbox.removeEntry?.(name);
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
