import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { drawSelection, dropCursor, EditorView, keymap, placeholder } from "@codemirror/view";
import { Strikethrough, TaskList } from "@lezer/markdown";
import { inputRules } from "./inputRules";
import { markdownKeymap } from "./listKeymap";
import { livePreview } from "./livePreview";
import { daybookEditorTheme } from "./theme";

export interface CreateEditorOptions {
  parent: HTMLElement;
  doc: string;
  placeholderText?: string;
  className?: string;
  autofocus?: boolean;
  onChange?: (doc: string) => void;
  onBlur?: () => void;
  onFocusChange?: (focused: boolean) => void;
}

export function createEditor(options: CreateEditorOptions): EditorView {
  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: options.doc,
      extensions: [
        history(),
        drawSelection(),
        dropCursor(),
        EditorView.lineWrapping,
        // addKeymap: false — lang-markdown's built-in Enter handler conflicts
        // with our list continuation and can delete continuation lines
        markdown({ base: markdownLanguage, extensions: [TaskList, Strikethrough], addKeymap: false }),
        placeholder(options.placeholderText ?? ""),
        daybookEditorTheme,
        livePreview,
        inputRules,
        markdownKeymap,
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.contentAttributes.of({
          spellcheck: "true",
          autocapitalize: "sentences",
        }),
        EditorView.domEventHandlers({
          blur: () => {
            options.onFocusChange?.(false);
            options.onBlur?.();
          },
          focus: () => {
            options.onFocusChange?.(true);
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            options.onChange?.(update.state.doc.toString());
          }
        }),
      ],
    }),
  });

  view.dom.classList.add("daybook-editor");
  if (options.className) {
    view.dom.classList.add(options.className);
  }

  if (options.autofocus) {
    requestAnimationFrame(() => view.focus());
  }

  return view;
}
