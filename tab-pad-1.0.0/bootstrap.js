// Pre-React theme/accent bootstrap. Lives in its own file because MV3's CSP
// (script-src 'self') blocks inline scripts on extension pages.
(function () {
  try {
    var raw = localStorage.getItem("tabpad:theme:v1") || localStorage.getItem("daybook:theme:v1");
    var stored = raw ? JSON.parse(raw).theme : "system";
    var dark = stored === "dark" || (stored === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    var accent = localStorage.getItem("tabpad:accent:v1") || localStorage.getItem("daybook:accent:v1");
    var allowed = ["green", "red", "yellow", "orange", "purple"];
    if (accent && allowed.indexOf(accent) !== -1) {
      document.documentElement.dataset.accent = accent;
    }
    // accent-colored favicon before React loads — keep colors in sync with
    // src/lib/theme.ts
    var faviconColors = {
      blue: "#2f6bff",
      green: "#16a34a",
      red: "#dc2626",
      yellow: "#ca8a04",
      orange: "#ea580c",
      purple: "#7c3aed",
    };
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="' +
      (faviconColors[accent] || faviconColors.blue) +
      '"/></svg>';
    var link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    link.href = "data:image/svg+xml," + encodeURIComponent(svg);
    document.head.appendChild(link);
  } catch (_) {}
})();
