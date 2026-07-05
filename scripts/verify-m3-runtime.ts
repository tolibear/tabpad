import { getListInfo } from "../src/editor/listKeymap";
import { rewriteTaskShortcut } from "../src/editor/inputRules";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(rewriteTaskShortcut("[] ") === "- [ ] ", "[] shortcut must rewrite to task item");
assert(rewriteTaskShortcut("  [ ] ") === "  - [ ] ", "[ ] shortcut must preserve indentation");
assert(rewriteTaskShortcut("- [ ] ") === null, "existing task item must not be rewritten");

const task = getListInfo("- [x] done");
assert(task?.kind === "task", "task list line must be detected");
assert(task.nextMarker === "- [ ] ", "task Enter must continue with an unchecked task");
assert(task.body === "done", "task body must be parsed");

const bullet = getListInfo("  - item");
assert(bullet?.kind === "bullet", "bullet list line must be detected");
assert(bullet.indent === "  ", "bullet indentation must be preserved");
assert(bullet.nextMarker === "- ", "bullet Enter must continue with a bullet marker");

const ordered = getListInfo("9. item");
assert(ordered?.kind === "ordered", "ordered list line must be detected");
assert(ordered.nextMarker === "10. ", "ordered list continuation must increment");
