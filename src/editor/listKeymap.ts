import { EditorSelection, type Command } from "@codemirror/state";
import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";

type ListKind = "task" | "bullet" | "ordered";

interface ListInfo {
  kind: ListKind;
  indent: string;
  marker: string;
  markerTo: number;
  body: string;
  nextMarker: string;
}

export function getListInfo(lineText: string): ListInfo | null {
  const task = /^(\s*)- \[([ xX])\]\s(.*)$/.exec(lineText);
  if (task) {
    return {
      kind: "task",
      indent: task[1],
      marker: "- [ ] ",
      markerTo: task[0].length - task[3].length,
      body: task[3],
      nextMarker: "- [ ] ",
    };
  }

  const bullet = /^(\s*)-\s(.*)$/.exec(lineText);
  if (bullet) {
    return {
      kind: "bullet",
      indent: bullet[1],
      marker: "- ",
      markerTo: bullet[1].length + 2,
      body: bullet[2],
      nextMarker: "- ",
    };
  }

  const ordered = /^(\s*)(\d+)\.\s(.*)$/.exec(lineText);
  if (ordered) {
    const nextNumber = Number.parseInt(ordered[2], 10) + 1;
    return {
      kind: "ordered",
      indent: ordered[1],
      marker: `${ordered[2]}. `,
      markerTo: ordered[1].length + ordered[2].length + 2,
      body: ordered[3],
      nextMarker: `${nextNumber}. `,
    };
  }

  return null;
}

export const continueList: Command = ({ state, dispatch }) => {
  const selection = state.selection.main;
  if (!selection.empty) return false;

  const line = state.doc.lineAt(selection.head);
  const info = getListInfo(line.text);
  if (!info) return false;
  // cursor before/inside the marker: plain newline, don't duplicate the marker
  if (selection.head < line.from + info.markerTo) return false;

  if (info.body.trim() === "") {
    dispatch(
      state.update({
        changes: { from: line.from + info.indent.length, to: line.from + info.markerTo, insert: "" },
        userEvent: "input.list.exit",
      }),
    );
    return true;
  }

  const insert = `\n${info.indent}${info.nextMarker}`;
  dispatch(
    state.update({
      changes: { from: selection.head, to: selection.head, insert },
      selection: EditorSelection.cursor(selection.head + insert.length),
      userEvent: "input.list.continue",
    }),
  );
  return true;
};

export const indentList: Command = ({ state, dispatch }) => {
  const line = state.doc.lineAt(state.selection.main.head);
  if (!getListInfo(line.text)) return false;
  dispatch(state.update({ changes: { from: line.from, insert: "  " }, userEvent: "input.list.indent" }));
  return true;
};

export const outdentList: Command = ({ state, dispatch }) => {
  const line = state.doc.lineAt(state.selection.main.head);
  if (!getListInfo(line.text) || !line.text.startsWith("  ")) return false;
  dispatch(state.update({ changes: { from: line.from, to: line.from + 2, insert: "" }, userEvent: "input.list.outdent" }));
  return true;
};

export const deleteEmptyListMarker: Command = ({ state, dispatch }) => {
  const selection = state.selection.main;
  if (!selection.empty) return false;

  const line = state.doc.lineAt(selection.head);
  const info = getListInfo(line.text);
  if (!info || info.body.trim() !== "" || selection.head !== line.from + info.markerTo) return false;

  dispatch(
    state.update({
      changes: { from: line.from + info.indent.length, to: line.from + info.markerTo, insert: "" },
      userEvent: "delete.list.marker",
    }),
  );
  return true;
};

function wrapSelection(left: string, right = left): Command {
  return ({ state, dispatch }) => {
    const range = state.selection.main;
    const selected = state.sliceDoc(range.from, range.to);
    const insert = `${left}${selected}${right}`;
    dispatch(
      state.update({
        changes: { from: range.from, to: range.to, insert },
        selection: EditorSelection.range(range.from + left.length, range.from + left.length + selected.length),
        userEvent: "input.markdown.wrap",
      }),
    );
    return true;
  };
}

export const markdownKeymap = Prec.highest(
  keymap.of([
    { key: "Enter", run: continueList },
    { key: "Tab", run: indentList },
    { key: "Shift-Tab", run: outdentList },
    { key: "Backspace", run: deleteEmptyListMarker },
    { key: "Mod-b", run: wrapSelection("**") },
    { key: "Mod-i", run: wrapSelection("*") },
  ]),
);
