import "fake-indexeddb/auto";
import { db } from "../src/db/db";
import { saveDayContent, saveDayMargin } from "../src/db/days";
import { savePanel } from "../src/db/panels";
import {
  queryMirrorPermission,
  requestMirrorPermission,
  writeDayMirror,
  writeFullMirror,
  type FileSystemDirectoryHandleLike,
  type FileSystemFileHandleLike,
  type FileSystemWritableFileStreamLike,
  type MirrorPermission,
} from "../src/mirror/mirror";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class MemoryWritable implements FileSystemWritableFileStreamLike {
  private chunks: string[] = [];

  constructor(private readonly file: MemoryFile) {}

  async write(data: BlobPart): Promise<void> {
    if (data instanceof Uint8Array) {
      this.chunks.push(Buffer.from(data).toString("utf8"));
      return;
    }
    this.chunks.push(String(data));
  }

  async close(): Promise<void> {
    this.file.content = this.chunks.join("");
  }
}

class MemoryFile implements FileSystemFileHandleLike {
  content = "";

  async createWritable(): Promise<FileSystemWritableFileStreamLike> {
    return new MemoryWritable(this);
  }
}

class MemoryDirectory implements FileSystemDirectoryHandleLike {
  files = new Map<string, MemoryFile>();
  directories = new Map<string, MemoryDirectory>();
  permission: MirrorPermission = "granted";

  constructor(readonly name: string) {}

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandleLike> {
    const existing = this.files.get(name);
    if (existing) return existing;
    if (!options?.create) throw new Error(`Missing file ${name}`);
    const file = new MemoryFile();
    this.files.set(name, file);
    return file;
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandleLike> {
    const existing = this.directories.get(name);
    if (existing) return existing;
    if (!options?.create) throw new Error(`Missing directory ${name}`);
    const directory = new MemoryDirectory(name);
    this.directories.set(name, directory);
    return directory;
  }

  async queryPermission(): Promise<MirrorPermission> {
    return this.permission;
  }

  async requestPermission(): Promise<MirrorPermission> {
    this.permission = "granted";
    return this.permission;
  }
}

await db.delete();
await db.open();

const root = new MemoryDirectory("notes");

await saveDayContent("2026-07-03", "# plans");
await saveDayMargin("2026-07-03", "side note");
await saveDayMargin("2026-07-04", "margin only");
await savePanel("scratchpad", "scratch");
await savePanel("masterList", "master");
await writeFullMirror(root);

assert(root.files.get("2026-07-03.md")?.content === "# plans", "day main markdown must write to root");
assert(root.files.get("scratchpad.md")?.content === "scratch", "scratchpad must write to root");
assert(root.files.get("master-list.md")?.content === "master", "master list must write to root");
assert(root.directories.get("margins")?.files.get("2026-07-03.md")?.content === "side note", "day margin must write under margins");
assert(root.directories.get("margins")?.files.get("2026-07-04.md")?.content === "margin only", "margin-only day must write a margin file");
assert(!root.files.has("2026-07-04.md"), "margin-only days must not create empty root files");

await writeDayMirror(root, { date: "2026-07-05", main: "new", margin: "", createdAt: 1, updatedAt: 2 });
assert(root.files.get("2026-07-05.md")?.content === "new", "single day mirror writes must update one day");

root.permission = "prompt";
assert((await queryMirrorPermission(root)) === "prompt", "permission query must return prompt");
assert((await requestMirrorPermission(root)) === "granted", "permission request must reconnect");

await db.delete();
