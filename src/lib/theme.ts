export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
export type AccentColor = "blue" | "green" | "red" | "yellow" | "orange" | "purple";

export const accentColors: AccentColor[] = ["blue", "green", "red", "yellow", "orange", "purple"];

const THEME_KEY = "daybook:theme:v1";
const ACCENT_KEY = "daybook:accent:v1";

export function isAccentColor(value: unknown): value is AccentColor {
  return accentColors.includes(value as AccentColor);
}

export function readAccentPreference(): AccentColor {
  try {
    const raw = localStorage.getItem(ACCENT_KEY);
    return raw && isAccentColor(raw) ? raw : "blue";
  } catch {
    return "blue";
  }
}

export function writeAccentPreference(accent: AccentColor): void {
  try {
    localStorage.setItem(ACCENT_KEY, accent);
  } catch {
    // Accent persistence is a convenience; Daybook remains usable without localStorage.
  }
}

export function applyAccent(accent: AccentColor): void {
  if (accent === "blue") {
    delete document.documentElement.dataset.accent;
  } else {
    document.documentElement.dataset.accent = accent;
  }
}

export function readThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (!raw) return "system";
    const value = JSON.parse(raw) as { theme?: unknown };
    return value.theme === "light" || value.theme === "dark" || value.theme === "system" ? value.theme : "system";
  } catch {
    return "system";
  }
}

export function writeThemePreference(theme: ThemePreference): void {
  try {
    localStorage.setItem(THEME_KEY, JSON.stringify({ theme }));
  } catch {
    // Theme persistence is a convenience; Daybook remains usable without localStorage.
  }
}

export function resolveTheme(preference: ThemePreference, systemTheme: ResolvedTheme): ResolvedTheme {
  return preference === "system" ? systemTheme : preference;
}

export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.dataset.theme = theme;
}

export function currentSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
