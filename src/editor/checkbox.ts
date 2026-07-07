import { WidgetType, type EditorView } from "@codemirror/view";
import { nextTaskMarker } from "../widgets/sources";

export class CheckboxWidget extends WidgetType {
  // the current 3-char marker: "[ ]" open, "[/]" in progress, "[x]"/"[X]" done
  constructor(
    private readonly marker: string,
    private readonly markerFrom: number,
  ) {
    super();
  }

  eq(other: CheckboxWidget): boolean {
    return other.marker === this.marker && other.markerFrom === this.markerFrom;
  }

  toDOM(view: EditorView): HTMLElement {
    const label = document.createElement("label");
    label.className = "cm-task-widget";

    const state = this.marker[1]?.toLowerCase();
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = state === "x";
    // in-progress renders its own accent square, not a native half-state
    if (state === "/") input.className = "cm-task-progress";
    input.addEventListener("change", () => {
      view.dispatch({
        changes: {
          from: this.markerFrom,
          to: this.markerFrom + 3,
          insert: nextTaskMarker(this.marker),
        },
        userEvent: "input.checkbox",
      });
      view.focus();
    });

    label.append(input);
    return label;
  }
}
