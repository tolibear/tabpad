import { EditorSurface } from "../editor/EditorSurface";
import { scrambleText } from "../lib/scramble";

interface RightPanelProps {
  show: boolean;
  privacyMode: boolean;
  value: string;
  onValueChange: (value: string) => void;
  onBlur: () => void;
  onFocusChange: (focused: boolean) => void;
}

export function RightPanel({ show, privacyMode, value, onValueChange, onBlur, onFocusChange }: RightPanelProps) {
  if (!show) return null;

  return (
    <aside className="right-panel" aria-label="scratchpad">
      <header>scratchpad</header>
      {privacyMode ? (
        // read-only gibberish while privacy mode is on — the real editor is
        // unmounted so nothing scrambled can round-trip into a save
        <div className="side-editor privacy-scramble">{scrambleText(value)}</div>
      ) : (
        <EditorSurface
          className="side-editor"
          placeholder=""
          value={value}
          onBlur={onBlur}
          onChange={onValueChange}
          onFocusChange={onFocusChange}
        />
      )}
    </aside>
  );
}
