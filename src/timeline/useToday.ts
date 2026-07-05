import { useCallback, useEffect, useState } from "react";
import { dateKey } from "../lib/dates";

export function useToday(): Date {
  const [today, setToday] = useState(() => new Date());

  const checkToday = useCallback(() => {
    // rolling the date remounts the today editor and moves focus — never do it
    // while the user is typing; the interval retries in a minute
    if (document.activeElement?.closest(".cm-content")) return;
    const next = new Date();
    setToday((current) => (dateKey(current) === dateKey(next) ? current : next));
  }, []);

  useEffect(() => {
    const interval = window.setInterval(checkToday, 60_000);
    window.addEventListener("focus", checkToday);
    document.addEventListener("visibilitychange", checkToday);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", checkToday);
      document.removeEventListener("visibilitychange", checkToday);
    };
  }, [checkToday]);

  return today;
}
