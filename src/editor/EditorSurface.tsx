import { useEffect, useLayoutEffect, useRef } from "react";
import { createEditor } from "./createEditor";
import type { EditorView } from "@codemirror/view";

interface EditorSurfaceProps {
  value: string;
  className?: string;
  placeholder?: string;
  autofocus?: boolean;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onFocusChange?: (focused: boolean) => void;
}

export function EditorSurface({
  value,
  className,
  placeholder,
  autofocus = false,
  onChange,
  onBlur,
  onFocusChange,
}: EditorSurfaceProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  const onFocusChangeRef = useRef(onFocusChange);

  useEffect(() => {
    onChangeRef.current = onChange;
    onBlurRef.current = onBlur;
    onFocusChangeRef.current = onFocusChange;
  }, [onBlur, onChange, onFocusChange]);

  // layout effect so the editor exists (with its real height) before the
  // browser paints — prepending days above the viewport stays jump-free
  useLayoutEffect(() => {
    if (!hostRef.current) return undefined;

    const view = createEditor({
      parent: hostRef.current,
      doc: value,
      placeholderText: placeholder,
      className,
      autofocus,
      onChange: (next) => onChangeRef.current(next),
      onBlur: () => onBlurRef.current?.(),
      onFocusChange: (focused) => onFocusChangeRef.current?.(focused),
    });

    viewRef.current = view;

    const routeFirstPrintableKey = (event: KeyboardEvent) => {
      if (!autofocus || view.hasFocus || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
      if (isEditableTarget(document.activeElement)) return;
      if (document.activeElement?.closest("button, a, [role='button']")) return;
      // never type into the note hidden behind an open overlay
      if (document.querySelector(".settings-backdrop, .palette-backdrop")) return;
      if (!view.state.selection.main.empty) return;

      event.preventDefault();
      view.focus();

      const selection = view.state.selection.main;
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: event.key },
        selection: { anchor: selection.from + event.key.length },
        userEvent: "input.type",
      });
    };

    document.addEventListener("keydown", routeFirstPrintableKey, { capture: true });

    return () => {
      document.removeEventListener("keydown", routeFirstPrintableKey, { capture: true });
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    // never clobber the editor the user is typing in — the debounced save
    // round-trip would reset the selection and flash the block
    if (view.hasFocus) return;

    const current = view.state.doc.toString();
    if (current === value) return;

    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  return <div className="editor-host" ref={hostRef} />;
}

function isEditableTarget(target: Element | null): boolean {
  if (!target) return false;
  if (target.closest(".cm-editor")) return true;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLElement && target.isContentEditable;
}
