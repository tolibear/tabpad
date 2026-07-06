import type { Settings } from "../db/db";
import { EditorSurface } from "../editor/EditorSurface";

interface RightPanelProps {
  mode: Settings["rightPanel"];
  value: string;
  onValueChange: (value: string) => void;
  onBlur: () => void;
  onFocusChange: (focused: boolean) => void;
}

export function RightPanel({ mode, value, onValueChange, onBlur, onFocusChange }: RightPanelProps) {
  if (mode !== "scratchpad") return null;

  return (
    <aside className="right-panel" aria-label="scratchpad">
      <header>scratchpad</header>
      <EditorSurface
        className="side-editor"
        placeholder=""
        value={value}
        onBlur={onBlur}
        onChange={onValueChange}
        onFocusChange={onFocusChange}
      />
    </aside>
  );
}
