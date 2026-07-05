import { EditorView } from "@codemirror/view";

export function rewriteTaskShortcut(lineText: string): string | null {
  const match = /^(\s*)(\[\]|\[ \]) $/.exec(lineText);
  return match ? `${match[1]}- [ ] ` : null;
}

export const inputRules = EditorView.updateListener.of((update) => {
  if (!update.docChanged || update.view.composing) return;
  // only rewrite direct typing — re-firing on undo/redo would trap history
  if (!update.transactions.some((tr) => tr.isUserEvent("input.type"))) return;

  const head = update.state.selection.main.head;
  const line = update.state.doc.lineAt(head);
  const rewrite = rewriteTaskShortcut(line.text);

  if (!rewrite || rewrite === line.text) return;

  update.view.dispatch({
    changes: { from: line.from, to: line.to, insert: rewrite },
    selection: { anchor: line.from + rewrite.length },
    userEvent: "input.rule.task",
  });
});
