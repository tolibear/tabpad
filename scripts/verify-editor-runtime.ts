import { getListInfo } from "../src/editor/listKeymap";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ---- getListInfo: Enter continues the right kind of list ----

const open = getListInfo("- [ ] a");
assert(open?.kind === "task", "`- [ ] a` is a task line");
assert(open.nextMarker === "- [ ] ", "a plain to-do continues as an unchecked to-do");

const done = getListInfo("- [x] a");
assert(done?.kind === "task", "`- [x] a` is a task line");
assert(done.nextMarker === "- [ ] ", "a checked to-do continues as an unchecked to-do");

// the bug: an in-progress `- [/]` to-do must continue the checklist, not fall
// through to a plain `- ` bullet
const progress = getListInfo("- [/] a");
assert(progress?.kind === "task", "`- [/] a` is a task line, not a bullet");
assert(progress.nextMarker === "- [ ] ", "an in-progress to-do continues as an unchecked to-do");
assert(progress.kind !== "bullet", "`- [/] a` must never be classified as a bullet");

// Enter on an empty in-progress marker clears/exits the list, same as [ ]/[x]:
// getListInfo reports an empty body and the full 6-char marker span that the
// exit path removes
const emptyProgress = getListInfo("- [/] ");
assert(emptyProgress?.kind === "task" && emptyProgress.body.trim() === "", "an empty `- [/] ` line has no body so Enter exits the list");
assert(emptyProgress.markerTo === 6, "the `- [/] ` marker spans all six chars the exit path removes");

const bullet = getListInfo("- a");
assert(bullet?.kind === "bullet", "`- a` is a bullet line");
assert(bullet.nextMarker === "- ", "a bullet continues as a bullet");

const ordered = getListInfo("1. a");
assert(ordered?.kind === "ordered", "`1. a` is an ordered line");
assert(ordered.nextMarker === "2. ", "an ordered item increments the number");

assert(getListInfo("plain text") === null, "a non-list line returns null");

console.log("editor runtime asserts passed");
