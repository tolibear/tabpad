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
}

export interface FileSystemDirectoryHandleLike {
  name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandleLike>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandleLike>;
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
