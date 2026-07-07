import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, ViewPlugin, WidgetType, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import { CheckboxWidget } from "./checkbox";

class BulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-bullet-widget";
    span.textContent = "•";
    return span;
  }
}

class QuoteWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-quote-widget";
    return span;
  }
}

class RuleWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-rule-widget";
    return span;
  }
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  // an unfocused editor has no "current line" — its parked cursor must not
  // keep markdown syntax visible
  const activeLines = view.hasFocus ? selectionLineNumbers(view) : new Set<number>();
  let inFence = false;

  for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber);
    const text = line.text;
    const isActive = activeLines.has(lineNumber);

    const fence = /^\s*```/.test(text);
    if (fence) {
      builder.add(line.from, line.from, Decoration.line({ class: "cm-md-codeblock" }));
      if (!isActive) {
        builder.add(line.from, line.to, Decoration.mark({ class: "cm-md-syntax cm-md-code-fence" }));
      }
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      builder.add(line.from, line.from, Decoration.line({ class: "cm-md-codeblock" }));
      continue;
    }

    addLineDecorations(builder, line.from, line.to, text, isActive);
  }

  return builder.finish();
}

function addLineDecorations(
  builder: RangeSetBuilder<Decoration>,
  lineFrom: number,
  lineTo: number,
  text: string,
  isActive: boolean,
) {
  const heading = /^(#{1,4})\s+/.exec(text);
  const task = /^(\s*)- \[([ xX/])\]\s/.exec(text);

  if (heading) {
    builder.add(lineFrom, lineFrom, Decoration.line({ class: `cm-md-heading cm-md-h${heading[1].length}` }));
    if (!isActive) {
      builder.add(lineFrom, lineFrom + heading[0].length, Decoration.replace({ class: "cm-md-hidden-syntax" }));
    }
  }

  if (task) {
    const markerFrom = lineFrom + task[1].length + 2;
    const markerTo = lineFrom + task[0].length;
    const marker = task[2].toLowerCase();
    const stateClass = marker === "x" ? " cm-md-task-checked" : marker === "/" ? " cm-md-task-progress" : "";
    // the line class carries a hanging indent so wrapped text aligns under
    // the first line's text instead of under the checkbox
    builder.add(
      lineFrom,
      lineFrom,
      Decoration.line({ class: `cm-md-task-line${stateClass}` }),
    );
    builder.add(lineFrom + task[1].length, markerTo, Decoration.replace({ widget: new CheckboxWidget(`[${task[2]}]`, markerFrom) }));
    // the task text still gets bold/links/etc — all inline matches start at or
    // after the marker, so builder order stays sorted
    if (!isActive) addInlineMarks(builder, lineFrom, text);
    return;
  }

  if (!isActive) {
    const bullet = /^(\s*)-\s/.exec(text);
    if (bullet) {
      builder.add(lineFrom, lineFrom, Decoration.line({ class: "cm-md-bullet-line" }));
      builder.add(lineFrom + bullet[1].length, lineFrom + bullet[0].length, Decoration.replace({ widget: new BulletWidget() }));
    }

    const quote = /^(\s*)>\s/.exec(text);
    if (quote) {
      builder.add(lineFrom, lineFrom, Decoration.line({ class: "cm-md-quote" }));
      builder.add(lineFrom + quote[1].length, lineFrom + quote[0].length, Decoration.replace({ widget: new QuoteWidget() }));
    }

    if (/^\s*---\s*$/.test(text)) {
      // block:true is not allowed from view plugins and would crash the editor
      builder.add(lineFrom, lineTo, Decoration.replace({ widget: new RuleWidget() }));
      return;
    }

    addInlineMarks(builder, lineFrom, text);
  }
}

interface InlineRange {
  from: number;
  to: number;
  deco: Decoration;
}

function addInlineMarks(builder: RangeSetBuilder<Decoration>, lineFrom: number, text: string) {
  // RangeSetBuilder requires ranges sorted by `from`, so collect every inline
  // mark first, sort, then add
  const ranges: InlineRange[] = [];
  collectDelimitedMark(ranges, lineFrom, text, /\*\*([^*\n]+)\*\*/g, 2, "cm-md-bold");
  collectDelimitedMark(ranges, lineFrom, text, /~~([^~\n]+)~~/g, 2, "cm-md-strike");
  collectDelimitedMark(ranges, lineFrom, text, /`([^`\n]+)`/g, 1, "cm-md-code");
  collectDelimitedMark(ranges, lineFrom, text, /(^|[^*])\*([^*\n]+)\*(?!\*)/g, 1, "cm-md-italic", true);
  collectLinks(ranges, lineFrom, text);
  ranges.sort((a, b) => a.from - b.from || a.deco.startSide - b.deco.startSide);
  for (const range of ranges) {
    builder.add(range.from, range.to, range.deco);
  }
}

function collectDelimitedMark(
  ranges: InlineRange[],
  lineFrom: number,
  text: string,
  pattern: RegExp,
  markerLength: number,
  className: string,
  hasLeadingGroup = false,
) {
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const leadingOffset = hasLeadingGroup ? match[1].length : 0;
    const start = lineFrom + match.index + leadingOffset;
    const end = lineFrom + match.index + match[0].length;
    const contentStart = start + markerLength;
    const contentEnd = end - markerLength;
    if (contentStart >= contentEnd) continue;
    ranges.push({ from: start, to: contentStart, deco: Decoration.replace({ class: "cm-md-hidden-syntax" }) });
    ranges.push({ from: contentStart, to: contentEnd, deco: Decoration.mark({ class: className }) });
    ranges.push({ from: contentEnd, to: end, deco: Decoration.replace({ class: "cm-md-hidden-syntax" }) });
  }
}

function collectLinks(ranges: InlineRange[], lineFrom: number, text: string) {
  const linkPattern = /\[([^\]\n]+)\]\(([^)\n]+)\)/g;
  for (const match of text.matchAll(linkPattern)) {
    if (match.index === undefined) continue;
    const start = lineFrom + match.index;
    const labelStart = start + 1;
    const labelEnd = labelStart + match[1].length;
    const end = start + match[0].length;
    ranges.push({ from: start, to: labelStart, deco: Decoration.replace({ class: "cm-md-hidden-syntax" }) });
    ranges.push({ from: labelStart, to: labelEnd, deco: Decoration.mark({ class: "cm-md-link" }) });
    ranges.push({ from: labelEnd, to: end, deco: Decoration.replace({ class: "cm-md-hidden-syntax" }) });
  }
}

function selectionLineNumbers(view: EditorView): Set<number> {
  const lines = new Set<number>();
  for (const range of view.state.selection.ranges) {
    const first = view.state.doc.lineAt(range.from).number;
    const last = view.state.doc.lineAt(range.to).number;
    for (let line = first; line <= last; line += 1) {
      lines.add(line);
    }
  }
  return lines;
}
