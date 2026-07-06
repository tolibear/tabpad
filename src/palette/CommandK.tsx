import { CalendarDays, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { parseDateJump } from "../lib/dates";

interface CommandKProps {
  today: Date;
  onJumpToDate: (date: Date) => void;
}

export function CommandK({ today, onJumpToDate }: CommandKProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
        setValue("");
        setError("");
        return;
      }
      // any other global shortcut dismisses the palette — but shift+arrows
      // inside a text field is just selection, never a shortcut
      if ((event.target as HTMLElement)?.closest?.("input, textarea, .cm-editor")) return;
      if (event.shiftKey && (event.code === "ArrowUp" || event.code === "ArrowDown")) {
        setOpen(false);
        setValue("");
        setError("");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [open]);

  const close = () => {
    setOpen(false);
    setValue("");
    setError("");
  };

  const submit = () => {
    const rawValue = inputRef.current?.value ?? value;
    const date = parseDateJump(rawValue, today);
    if (!date) {
      setError("try friday, nov 12, two weeks ago, or 7/4");
      return;
    }

    onJumpToDate(date);
    close();
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  };

  if (!open) return null;

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="palette-panel" role="dialog" aria-modal="true" aria-label="date">
        <CalendarDays className="palette-icon" aria-hidden="true" size={18} strokeWidth={1.8} />
        <input
          ref={inputRef}
          className="palette-input"
          value={value}
          placeholder="friday, nov 12, two weeks ago..."
          aria-describedby={error ? "date-palette-error" : undefined}
          onChange={(event) => {
            setValue(event.currentTarget.value);
            setError("");
          }}
          onKeyDown={handleInputKeyDown}
        />
        <button className="palette-close" type="button" aria-label="close" onClick={close}>
          <X aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>
        {error ? (
          <p className="palette-hint" id="date-palette-error">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
