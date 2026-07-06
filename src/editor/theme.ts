import { EditorView } from "@codemirror/view";

export const tabPadEditorTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "var(--ink)",
    fontFamily: "var(--app-font, Inter, ui-sans-serif, system-ui, sans-serif)",
    fontSize: "var(--editor-font-size, 15px)",
    lineHeight: "1.7",
  },
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "inherit",
    overflow: "visible",
  },
  ".cm-content": {
    caretColor: "var(--accent)",
    padding: "0",
  },
  ".cm-line": {
    padding: "0",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--accent)",
  },
  ".cm-selectionBackground": {
    backgroundColor: "var(--accent-soft) !important",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-placeholder": {
    color: "var(--faint)",
  },
});
