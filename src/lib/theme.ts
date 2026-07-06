export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
export type AccentColor = "blue" | "green" | "red" | "yellow" | "orange" | "purple";

export const accentColors: AccentColor[] = ["blue", "green", "red", "yellow", "orange", "purple"];

const THEME_KEY = "tabpad:theme:v1";
const LEGACY_THEME_KEY = "daybook:theme:v1";
const ACCENT_KEY = "tabpad:accent:v1";
const LEGACY_ACCENT_KEY = "daybook:accent:v1";

export function isAccentColor(value: unknown): value is AccentColor {
  return accentColors.includes(value as AccentColor);
}

export function readAccentPreference(): AccentColor {
  try {
    const raw = localStorage.getItem(ACCENT_KEY) ?? localStorage.getItem(LEGACY_ACCENT_KEY);
    return raw && isAccentColor(raw) ? raw : "blue";
  } catch {
    return "blue";
  }
}

export function writeAccentPreference(accent: AccentColor): void {
  try {
    localStorage.setItem(ACCENT_KEY, accent);
  } catch {
    // Accent persistence is a convenience; Tab Pad remains usable without localStorage.
  }
}

// saturated (light-theme) accent values — keep in sync with tokens.css and
// public/bootstrap.js
const faviconColors: Record<AccentColor, string> = {
  blue: "#2f6bff",
  green: "#16a34a",
  red: "#dc2626",
  yellow: "#ca8a04",
  orange: "#ea580c",
  purple: "#7c3aed",
};

export function applyAccent(accent: AccentColor): void {
  if (accent === "blue") {
    delete document.documentElement.dataset.accent;
  } else {
    document.documentElement.dataset.accent = accent;
  }
  applyFavicon(accent);
}

// the tab's icon is a dot in the chosen accent color
export function applyFavicon(accent: AccentColor): void {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="${faviconColors[accent]}"/></svg>`;
  let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.type = "image/svg+xml";
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function readThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_KEY) ?? localStorage.getItem(LEGACY_THEME_KEY);
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
    // Theme persistence is a convenience; Tab Pad remains usable without localStorage.
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
