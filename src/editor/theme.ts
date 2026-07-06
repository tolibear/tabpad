import { EditorView } from "@codemirror/view";

export const tabPadEditorTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    // --editor-ink lets a container (the day margin) mute its editor's text
    color: "var(--editor-ink, var(--ink))",
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
  // hanging indents MUST live here: the injected `.cm-line { padding: 0 }`
  // above beats any app.css padding, and an unpaired negative text-indent
  // shoves the markers out of the column
  ".cm-line.cm-md-task-line": {
    paddingLeft: "22px",
    textIndent: "-22px",
  },
  ".cm-line.cm-md-bullet-line": {
    paddingLeft: "18px",
    textIndent: "-18px",
  },
  ".cm-line.cm-md-quote": {
    paddingLeft: "8px",
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
