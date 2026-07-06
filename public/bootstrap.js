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
  } catch (_) {}
})();
