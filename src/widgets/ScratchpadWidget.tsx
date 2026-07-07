import type { WidgetRow } from "../db/db";
import { EditorSurface } from "../editor/EditorSurface";
import { scrambleText } from "../lib/scramble";
import { sanitizeScratchpadConfig } from "./registry";
import type { WidgetContext } from "./WidgetShell";

// a scratchpad editor — the core "scratchpad" widget is backed by
// panels("scratchpad") + root scratchpad.md, and every other scratchpad widget
// by its own panels("widget:<id>") + widgets/<id>.md. the context resolves the
// right content source by widget id, so each instance is independent.
export function ScratchpadWidget({ row, context }: { row: WidgetRow; context: WidgetContext }) {
  const config = sanitizeScratchpadConfig(row.config);
  const scratchpad = context.scratchpadFor(row.id);
  const style = config.height === "fixed" ? { maxHeight: `${config.maxHeight}px` } : undefined;

  return (
    <div className="scratchpad-widget" data-height={config.height} style={style}>
      {context.privacyMode ? (
        // read-only gibberish while privacy mode is on — the real editor is
        // unmounted so nothing scrambled can round-trip into a save
        <div className="side-editor privacy-scramble">{scrambleText(scratchpad.value)}</div>
      ) : (
        <EditorSurface
          className="side-editor"
          placeholder=""
          value={scratchpad.value}
          onBlur={scratchpad.onBlur}
          onChange={scratchpad.onChange}
          onFocusChange={scratchpad.onFocusChange}
        />
      )}
    </div>
  );
}
