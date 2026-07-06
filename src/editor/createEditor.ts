import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { drawSelection, dropCursor, EditorView, keymap, placeholder } from "@codemirror/view";
import { Strikethrough, TaskList } from "@lezer/markdown";
import { inputRules } from "./inputRules";
import { markdownKeymap } from "./listKeymap";
import { livePreview } from "./livePreview";
import { tabPadEditorTheme } from "./theme";

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
        tabPadEditorTheme,
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
          // cmd/ctrl+click on a link opens it in a new tab
          mousedown: (event, view) => {
            if (!event.metaKey && !event.ctrlKey) return false;
            const url = linkAtCoords(view, event.clientX, event.clientY);
            if (!url) return false;
            event.preventDefault();
            window.open(url, "_blank", "noopener");
            return true;
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

  view.dom.classList.add("tabpad-editor");
  if (options.className) {
    view.dom.classList.add(options.className);
  }

  ensureLinkModifierCursor();

  if (options.autofocus) {
    // a midnight rollover remounts the today editor while the user's cursor
    // may be parked in another note — never steal focus from a live editor
    requestAnimationFrame(() => {
      if (!document.activeElement?.closest(".cm-editor")) view.focus();
    });
  }

  return view;
}

// find a markdown link or bare URL at the clicked document position
function linkAtCoords(view: EditorView, x: number, y: number): string | null {
  const pos = view.posAtCoords({ x, y });
  if (pos === null) return null;
  const line = view.state.doc.lineAt(pos);
  const offset = pos - line.from;

  for (const match of line.text.matchAll(/\[([^\]\n]+)\]\(([^)\n]+)\)/g)) {
    if (match.index !== undefined && offset >= match.index && offset <= match.index + match[0].length) {
      return normalizeUrl(match[2]);
    }
  }
  for (const match of line.text.matchAll(/https?:\/\/[^\s)]+/g)) {
    if (match.index !== undefined && offset >= match.index && offset <= match.index + match[0].length) {
      return normalizeUrl(match[0]);
    }
  }
  return null;
}

function normalizeUrl(raw: string): string | null {
  const url = raw.trim();
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) return url;
  // "[tabpad.app](tabpad.app)" — scheme-less domains get https
  if (/^[\w-]+(\.[\w-]+)+([/?#]\S*)?$/i.test(url)) return `https://${url}`;
  return null;
}

// while cmd/ctrl is held, links show the hand cursor (styled via
// body.link-modifier in app.css) — registered once for the whole page
let linkModifierInstalled = false;
function ensureLinkModifierCursor(): void {
  if (linkModifierInstalled || typeof window === "undefined") return;
  linkModifierInstalled = true;
  const set = (on: boolean) => document.body.classList.toggle("link-modifier", on);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Meta" || event.key === "Control") set(true);
  });
  window.addEventListener("keyup", (event) => {
    if (event.key === "Meta" || event.key === "Control") set(false);
  });
  // cmd+tab away can eat the keyup — never leave the cursor stuck
  window.addEventListener("blur", () => set(false));
}
