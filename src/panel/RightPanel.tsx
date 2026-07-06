import { EditorSurface } from "../editor/EditorSurface";

interface RightPanelProps {
  show: boolean;
  value: string;
  onValueChange: (value: string) => void;
  onBlur: () => void;
  onFocusChange: (focused: boolean) => void;
}

export function RightPanel({ show, value, onValueChange, onBlur, onFocusChange }: RightPanelProps) {
  if (!show) return null;

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
