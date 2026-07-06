import { useCallback, useEffect, useState } from "react";
import { dateKey } from "../lib/dates";

export function useToday(): Date {
  const [today, setToday] = useState(() => new Date());

  const checkToday = useCallback(() => {
    // rolling the date remounts the today editor and moves focus — defer only
    // while the user is ACTIVELY typing (a parked cursor must not pin the app
    // to yesterday forever)
    if (
      document.hasFocus() &&
      document.activeElement?.closest(".cm-content") &&
      Date.now() - lastTypedAt < 90_000
    ) {
      return;
    }
    const next = new Date();
    setToday((current) => (dateKey(current) === dateKey(next) ? current : next));
  }, []);

  useEffect(() => {
    const interval = window.setInterval(checkToday, 60_000);
    window.addEventListener("focus", checkToday);
    window.addEventListener("keydown", markTyping, { capture: true, passive: true });
    document.addEventListener("visibilitychange", checkToday);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", checkToday);
      window.removeEventListener("keydown", markTyping, { capture: true });
      document.removeEventListener("visibilitychange", checkToday);
    };
  }, [checkToday]);

  return today;
}

let lastTypedAt = 0;
function markTyping(): void {
  lastTypedAt = Date.now();
}
