import type { WidgetRow } from "../db/db";
import { EditorSurface } from "../editor/EditorSurface";
import { scrambleText } from "../lib/scramble";
import { sanitizeScratchpadConfig } from "./registry";
import type { WidgetContext } from "./WidgetShell";

// the one persistent scratchpad — backed by panels("scratchpad") and mirrored
// to scratchpad.md exactly as the old right panel was. the editor plumbing
// (value + save/focus handlers) rides in on the widget context so every rail
// shares one source of truth.
export function ScratchpadWidget({ row, context }: { row: WidgetRow; context: WidgetContext }) {
  const config = sanitizeScratchpadConfig(row.config);
  const scratchpad = context.scratchpad;
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
