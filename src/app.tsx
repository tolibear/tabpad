import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createTabPadChannel, type TabPadChannel } from "./db/broadcast";
import { migrateLegacyDb, type DayRow, type PanelRow, type Settings, type WidgetRow } from "./db/db";
import { eraseAllNotes, getDay, hasDayContent, listAllDays, listContentDays, saveDayFields } from "./db/days";
import { deleteWidget, ensureDefaultWidgets, listWidgets, sanitizeColumn, saveWidget } from "./db/widgets";
import { sanitizeWidgetConfig } from "./widgets/registry";
import type { WidgetContext } from "./widgets/WidgetShell";
import { createExportPayload, importPayload, serializeExport } from "./db/export";
import { seedOnboardingIfFirstRun } from "./db/onboarding";
import { getPanel, savePanel } from "./db/panels";
import { getSettings, saveSettings } from "./db/settings";
import { addDays, dateFromKey, dateKey, daysBetween } from "./lib/dates";
import {
  applyAccent,
  applyTheme,
  currentSystemTheme,
  readAccentPreference,
  readThemePreference,
  resolveTheme,
  type AccentColor,
  type ResolvedTheme,
  type ThemePreference,
  writeAccentPreference,
  writeThemePreference,
} from "./lib/theme";
import { CommandK } from "./palette/CommandK";
import { Rail, RightRail } from "./rail/Rail";
import { SettingsOverlay } from "./settings/SettingsOverlay";
import { Timeline, type JumpTarget } from "./timeline/Timeline";
import { useToday } from "./timeline/useToday";
import {
  getMirrorDirectory,
  isMirrorPermissionError,
  pickMirrorDirectory,
  queryMirrorPermission,
  queryMirrorStatus,
  eraseMirrorFiles,
  isMirrorSupported,
  requestMirrorPermission,
  syncWithDisk,
  type FileSystemDirectoryHandleLike,
  type MirrorStatus,
  type WidgetFileIssue,
  removeWidgetMirrorFile,
  writeAgentFiles,
  writeDayMirror,
  writeFullMirror,
  writePanelMirror,
  writeWidgetsMirror,
} from "./mirror/mirror";

// privacy mode persists in localStorage (not the settings db) so every new
// tab opens hidden while it's on — important when screen sharing
const PRIVACY_KEY = "tabpad:privacy:v1";

function readPrivacyPreference(): boolean {
  try {
    return localStorage.getItem(PRIVACY_KEY) === "1";
  } catch {
    return false;
  }
}

// focus mode persists the same way: a new tab opens focused on the same day
const FOCUS_KEY = "tabpad:focus:v1";

function readFocusPreference(): string | null {
  try {
    const raw = localStorage.getItem(FOCUS_KEY);
    return raw && dateFromKey(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function App() {
  const today = useToday();
  const todayKey = dateKey(today);
  const channelRef = useRef<TabPadChannel | null>(null);
  const focusedDayRef = useRef<string | null>(null);
  const focusedMarginRef = useRef<string | null>(null);
  const focusedPanelRef = useRef<PanelRow["id"] | null>(null);
  const dayTextsRef = useRef<Record<string, string>>({});
  const dayMarginsRef = useRef<Record<string, string>>({});
  const panelTextsRef = useRef<Record<PanelRow["id"], string>>({ scratchpad: "" } as Record<PanelRow["id"], string>);
  const mirrorHandleRef = useRef<FileSystemDirectoryHandleLike | null>(null);
  const storagePersistRequested = useRef(false);
  // timers carry the row snapshot they will write, so a flush never has to
  // re-derive content from this tab's (possibly stale) text refs
  const mirrorDayTimers = useRef(new Map<string, { timer: number; row: DayRow }>());
  const mirrorPanelTimers = useRef(new Map<PanelRow["id"], { timer: number; panel: PanelRow }>());
  const eraseGuardTimer = useRef(0);
  const queueMirrorDayRef = useRef<(row: DayRow | null) => void>(() => {});
  const queueMirrorWidgetsRef = useRef<() => void>(() => {});
  const syncMtimes = useRef(new Map<string, number>());
  const syncFailures = useRef(0);
  const syncChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const erasingRef = useRef(false);

  const [themePreference, setThemePreference] = useState<ThemePreference>(() => readThemePreference());
  const [accent, setAccent] = useState<AccentColor>(() => readAccentPreference());
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => currentSystemTheme());
  const [weekStartsOn, setWeekStartsOn] = useState<0 | 1>(0);
  const [showDayMargins, setShowDayMargins] = useState(false);
  const [editorSize, setEditorSize] = useState<Settings["editorSize"]>("md");
  const [font, setFont] = useState<Settings["font"]>("sans");
  const [mirrorStatus, setMirrorStatus] = useState<MirrorStatus>("off");
  const [mirrorName, setMirrorName] = useState("");
  const [dayTexts, setDayTexts] = useState<Record<string, string>>({});
  const [dayMargins, setDayMargins] = useState<Record<string, string>>({});
  const [panelTexts, setPanelTexts] = useState<Record<PanelRow["id"], string>>({ scratchpad: "" } as Record<PanelRow["id"], string>);
  const [contentDays, setContentDays] = useState<DayRow[]>([]);
  const [widgets, setWidgets] = useState<WidgetRow[]>([]);
  const [widgetFileIssues, setWidgetFileIssues] = useState<WidgetFileIssue[]>([]);
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);
  const [saveError, setSaveError] = useState(false);
  const [dataMessage, setDataMessage] = useState("");
  const [jumpTarget, setJumpTarget] = useState<JumpTarget | null>(null);
  const [currentTopKey, setCurrentTopKey] = useState(todayKey);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // focus mode: one day takes over the whole view
  const [focusDayKey, setFocusDayKey] = useState<string | null>(() => readFocusPreference());
  const [privacyMode, setPrivacyMode] = useState(() => readPrivacyPreference());
  const resolvedTheme = resolveTheme(themePreference, systemTheme);
  const todayText = dayTexts[todayKey] ?? "";

  useLayoutEffect(() => {
    if (!performance.getEntriesByName("tabpad:shell-ready").length) {
      performance.mark("tabpad:shell-ready");
    }
  }, []);

  useEffect(() => {
    if (!loaded || performance.getEntriesByName("tabpad:today-content-ready").length) return;
    if (document.querySelector(".day-section.today .cm-content")) {
      performance.mark("tabpad:today-content-ready");
    }
  }, [loaded, todayKey]);

  useEffect(() => {
    setCurrentTopKey(todayKey);
  }, [todayKey]);

  useEffect(() => {
    dayTextsRef.current = dayTexts;
  }, [dayTexts]);

  useEffect(() => {
    dayMarginsRef.current = dayMargins;
  }, [dayMargins]);

  useEffect(() => {
    panelTextsRef.current = panelTexts;
  }, [panelTexts]);

  const applySettingsState = useCallback((settings: Settings) => {
    setThemePreference(settings.theme);
    setAccent(settings.accent);
    setWeekStartsOn(settings.weekStartsOn);
    setShowDayMargins(settings.margins);
    setEditorSize(settings.editorSize);
    setFont(settings.font);
  }, []);

  // the folder is the app's storage — always active once a folder is chosen;
  // "off" only means no folder has been picked yet
  const refreshMirrorState = useCallback(async () => {
    const handle = await getMirrorDirectory();
    mirrorHandleRef.current = handle;
    setMirrorName(handle?.name ?? "");
    const status = await queryMirrorStatus(handle);
    setMirrorStatus(status);
    return handle;
  }, []);

  const refreshContentDays = useCallback(async () => {
    // iterate ALL rows (including externally-cleared, now-empty ones) so
    // cleared notes blank on screen — but keys with NO row at all are drafts
    // that never persisted, and must be left untouched
    const all = await listAllDays();
    setContentDays(all.filter((row) => hasDayContent(row.main, row.margin)));
    setDayTexts((current) => {
      const next = { ...current };
      for (const row of all) {
        if (focusedDayRef.current !== row.date) {
          next[row.date] = row.main;
        }
      }
      return next;
    });
    setDayMargins((current) => {
      const next = { ...current };
      for (const row of all) {
        if (focusedMarginRef.current !== row.date) {
          next[row.date] = row.margin;
        }
      }
      return next;
    });
  }, []);

  const refreshWidgets = useCallback(async () => {
    setWidgets(await listWidgets());
  }, []);

  // apply reported widget-file issues without churning identity — the 3-second
  // poll calls this every pass, and an unchanged list must not re-render the rail
  const applyWidgetIssues = useCallback((issues: WidgetFileIssue[]) => {
    setWidgetFileIssues((current) =>
      current.length === issues.length &&
      current.every((issue, index) => issue.file === issues[index].file && issue.error === issues[index].error)
        ? current
        : issues,
    );
  }, []);

  // widget changes are tiny and rare — one debounced full rewrite of widgets/
  const mirrorWidgetsTimer = useRef(0);
  const flushMirrorWidgets = useCallback(() => {
    if (mirrorStatus !== "connected" || erasingRef.current) return Promise.resolve();
    const run = async () => {
      if (erasingRef.current) return;
      const handle = mirrorHandleRef.current;
      if (!handle) return;
      try {
        await writeWidgetsMirror(handle, await listWidgets());
        syncFailures.current = 0;
      } catch (error) {
        console.warn("Tab Pad widget mirror failed", error);
        if (isMirrorPermissionError(error)) setMirrorStatus("reconnect");
        else if ((syncFailures.current += 1) >= 3) setMirrorStatus("error");
      }
    };
    const result = syncChainRef.current.then(run, run);
    syncChainRef.current = result.catch(() => undefined);
    return result;
  }, [mirrorStatus]);

  const queueMirrorWidgets = useCallback(() => {
    if (mirrorStatus !== "connected" || erasingRef.current) return;
    window.clearTimeout(mirrorWidgetsTimer.current);
    mirrorWidgetsTimer.current = window.setTimeout(() => {
      void flushMirrorWidgets();
    }, 800);
  }, [flushMirrorWidgets, mirrorStatus]);

  // keep a ref current so the broadcast listener (bound once) can mirror
  // another tab's widget edit through this tab's connection
  useEffect(() => {
    queueMirrorWidgetsRef.current = queueMirrorWidgets;
  }, [queueMirrorWidgets]);

  // every widget change: persist, refresh this tab, tell other tabs, mirror.
  const applyWidgetChange = useCallback(
    async (change: () => Promise<void>) => {
      await change();
      await refreshWidgets();
      channelRef.current?.post({ type: "widgets", key: "all", updatedAt: Date.now() });
      queueMirrorWidgets();
    },
    [queueMirrorWidgets, refreshWidgets],
  );

  const handleWidgetSave = useCallback(
    (row: WidgetRow) => {
      void applyWidgetChange(() =>
        saveWidget({ ...row, config: sanitizeWidgetConfig(row.type, row.config), updatedAt: Date.now() }),
      );
    },
    [applyWidgetChange],
  );

  const handleWidgetToggle = useCallback(
    (id: string, enabled: boolean) => {
      void applyWidgetChange(async () => {
        const row = (await listWidgets()).find((w) => w.id === id);
        if (row) await saveWidget({ ...row, enabled, updatedAt: Date.now() });
      });
    },
    [applyWidgetChange],
  );

  const handleWidgetMove = useCallback(
    (id: string, direction: -1 | 1) => {
      void applyWidgetChange(async () => {
        const rows = await listWidgets();
        const index = rows.findIndex((w) => w.id === id);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= rows.length) return;
        const reordered = [...rows];
        [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
        const now = Date.now();
        // rewrite order as clean indexes so duplicates (imports, file sync) heal
        for (const [position, row] of reordered.entries()) {
          if (row.order !== position) await saveWidget({ ...row, order: position, updatedAt: now });
        }
      });
    },
    [applyWidgetChange],
  );

  const handleWidgetDelete = useCallback(
    (id: string) => {
      void applyWidgetChange(async () => {
        const handle = mirrorHandleRef.current;
        if (handle && mirrorStatus === "connected") {
          await removeWidgetMirrorFile(handle, id).catch((error) =>
            console.warn("Tab Pad widget file removal failed", error),
          );
        }
        // deleteWidget tombstones the id, so even a failed/racing file removal
        // (or a delete from a tab without the folder connection) cannot
        // resurrect the widget on the next sync pass
        await deleteWidget(id);
      });
    },
    [applyWidgetChange, mirrorStatus],
  );

  const loadDocuments = useCallback(async () => {
    await migrateLegacyDb();
    // after migration so legacy users are never treated as fresh installs.
    // the first session opens in focus mode on the welcome note — writing the
    // first note comes before discovering the timeline
    if (await seedOnboardingIfFirstRun(today)) {
      setFocusDayKey(todayKey);
    }
    await ensureDefaultWidgets();
    // pull in any file edits (agents, other apps) before loading state below —
    // humans and agents share the same files
    try {
      const handle = await getMirrorDirectory();
      if (handle && (await queryMirrorPermission(handle)) === "granted") {
        const run = async () => {
          if (erasingRef.current) return;
          await syncWithDisk(handle, syncMtimes.current, () => ({
            day: focusedDayRef.current,
            margin: focusedMarginRef.current,
            scratchpad: focusedPanelRef.current === "scratchpad",
          }), applyWidgetIssues);
        };
        const pass = syncChainRef.current.then(run, run);
        syncChainRef.current = pass.catch(() => undefined);
        await pass;
      }
    } catch (error) {
      console.warn("Tab Pad folder sync failed", error);
    }

    const [day, scratchpad, settings, rows, widgetRows] = await Promise.all([
      getDay(todayKey),
      getPanel("scratchpad"),
      getSettings(),
      listContentDays(),
      listWidgets(),
    ]);
    // apply-time focus guards: never overwrite the day/panel currently being typed in
    setDayTexts((current) => {
      const next = { ...current };
      if (focusedDayRef.current !== todayKey) next[todayKey] = day?.main ?? current[todayKey] ?? "";
      for (const row of rows) {
        if (focusedDayRef.current !== row.date) next[row.date] = row.main;
      }
      return next;
    });
    setDayMargins((current) => {
      const next = { ...current };
      if (focusedMarginRef.current !== todayKey) next[todayKey] = day?.margin ?? current[todayKey] ?? "";
      for (const row of rows) {
        if (focusedMarginRef.current !== row.date) next[row.date] = row.margin;
      }
      return next;
    });
    setPanelTexts((current) =>
      focusedPanelRef.current === "scratchpad" ? current : { ...current, scratchpad: scratchpad.content },
    );
    applySettingsState(settings);
    void refreshMirrorState();
    setContentDays(rows);
    setWidgets(widgetRows);
    loadedRef.current = true;
    setLoaded(true);
  }, [applySettingsState, applyWidgetIssues, refreshMirrorState, todayKey]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    const channel = createTabPadChannel();
    channelRef.current = channel;
    const stop = channel.listen((message) => {
      if (message.type === "day") {
        void getDay(message.key).then((row) => {
          // mid-erase, a straggler save broadcast from another tab must not
          // repopulate this tab's state (and get mirrored back to disk)
          if (erasingRef.current) return;
          // re-check focus at apply time — it may have moved during the read
          setDayTexts((current) =>
            focusedDayRef.current === message.key ? current : { ...current, [message.key]: row?.main ?? "" },
          );
          setDayMargins((current) =>
            focusedMarginRef.current === message.key ? current : { ...current, [message.key]: row?.margin ?? "" },
          );
          // if this tab holds the folder connection, mirror the other tab's edit
          queueMirrorDayRef.current(row ?? null);
        });
      }
      if (message.type === "panel" && message.key === "scratchpad") {
        void getPanel(message.key).then((panel) => {
          if (erasingRef.current) return;
          setPanelTexts((current) =>
            focusedPanelRef.current === message.key ? current : { ...current, [message.key]: panel.content },
          );
        });
      }
      if (message.type === "settings") {
        void getSettings().then((settings) => {
          applySettingsState(settings);
          void refreshMirrorState();
        });
      }
      if (message.type === "widgets") {
        void refreshWidgets().then(() => queueMirrorWidgetsRef.current());
      }
      if (message.type === "erase") {
        // another tab is erasing: drop anything this tab could write back —
        // pending mirror timers, local texts, and the refs that feed queued
        // saves (a queued save reading empty refs becomes a no-op)
        erasingRef.current = true;
        for (const pending of mirrorDayTimers.current.values()) window.clearTimeout(pending.timer);
        for (const pending of mirrorPanelTimers.current.values()) window.clearTimeout(pending.timer);
        mirrorDayTimers.current.clear();
        mirrorPanelTimers.current.clear();
        window.clearTimeout(mirrorWidgetsTimer.current);
        mirrorWidgetsTimer.current = 0;
        syncMtimes.current = new Map();
        setDayTexts({});
        setDayMargins({});
        setPanelTexts({ scratchpad: "" } as Record<PanelRow["id"], string>);
        dayTextsRef.current = {};
        dayMarginsRef.current = {};
        panelTextsRef.current = { scratchpad: "" } as Record<PanelRow["id"], string>;
        // the erasing tab posts "import" when done; this is only a safety net
        // in case that tab dies mid-erase
        window.clearTimeout(eraseGuardTimer.current);
        eraseGuardTimer.current = window.setTimeout(() => {
          erasingRef.current = false;
        }, 30_000);
      }
      if (message.type === "import") {
        window.clearTimeout(eraseGuardTimer.current);
        erasingRef.current = false;
        void loadDocuments();
      }
      if (message.type === "day" || message.type === "import") {
        void refreshContentDays();
      }
    });

    return () => {
      stop();
      channel.close();
      channelRef.current = null;
    };
  }, [applySettingsState, loadDocuments, refreshContentDays, refreshMirrorState, refreshWidgets, todayKey]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemTheme(media.matches ? "dark" : "light");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    writeThemePreference(themePreference);
    applyTheme(resolvedTheme);
  }, [resolvedTheme, themePreference]);

  useEffect(() => {
    writeAccentPreference(accent);
    applyAccent(accent);
  }, [accent]);

  // shared sync entry point: always uses the mtime cache and always skips
  // whatever the user currently has focused, then propagates imports to state
  const syncFolderNow = useCallback((handle: FileSystemDirectoryHandleLike) => {
    // serialize all sync entrances (poll, blur nudge, window focus, regrant)
    // so two passes can't interleave reconciles of the same file
    const run = async () => {
      if (erasingRef.current) return 0;
      const imported = await syncWithDisk(handle, syncMtimes.current, () => ({
        day: focusedDayRef.current,
        margin: focusedMarginRef.current,
        scratchpad: focusedPanelRef.current === "scratchpad",
      }), applyWidgetIssues);
      syncFailures.current = 0;
      if (imported > 0) {
        await refreshContentDays();
        await refreshWidgets();
        const scratch = await getPanel("scratchpad");
        setPanelTexts((current) =>
          focusedPanelRef.current === "scratchpad" ? current : { ...current, scratchpad: scratch.content },
        );
      }
      return imported;
    };
    const result = syncChainRef.current.then(run, run);
    syncChainRef.current = result.catch(() => undefined);
    return result;
  }, [applyWidgetIssues, refreshContentDays, refreshWidgets]);

  // deferred (focused-note) changes land the moment the user clicks away
  const nudgeSync = useCallback(() => {
    window.setTimeout(() => {
      const handle = mirrorHandleRef.current;
      if (handle) void syncFolderNow(handle).catch(() => undefined);
    }, 350);
  }, [syncFolderNow]);

  // LIVE sync: while the tab is visible, poll the folder every few seconds so
  // external edits (agents, other apps) appear without a refresh. The mtime
  // cache makes unchanged files free to skip.
  useEffect(() => {
    if (!loaded || mirrorStatus !== "connected") return;

    let stopped = false;
    let running = false;
    const tick = async () => {
      if (stopped || running || document.visibilityState !== "visible") return;
      const handle = mirrorHandleRef.current;
      if (!handle) return;
      running = true;
      try {
        await syncFolderNow(handle);
      } catch (error) {
        console.warn("Tab Pad live sync failed", error);
        // a deleted/unplugged folder must not stay silently "connected"
        syncFailures.current += 1;
        if (syncFailures.current >= 3 && !stopped) {
          setMirrorStatus(isMirrorPermissionError(error) ? "reconnect" : "error");
        }
      } finally {
        running = false;
      }
    };

    const interval = window.setInterval(() => void tick(), 3000);
    void tick();
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [loaded, mirrorStatus, syncFolderNow]);

  // extension reloads and browser restarts silently revoke the folder
  // permission — use the user's first gesture to re-request it automatically
  useEffect(() => {
    if (!loaded || mirrorStatus !== "reconnect") return;

    const tryRegrant = () => {
      void (async () => {
        try {
          const handle = mirrorHandleRef.current ?? (await getMirrorDirectory());
          if (!handle) return;
          if ((await requestMirrorPermission(handle)) !== "granted") return;
          mirrorHandleRef.current = handle;
          setMirrorName(handle.name);
          setMirrorStatus("connected");
          syncFailures.current = 0;
          await syncFolderNow(handle);
          await writeFullMirror(handle);
          await refreshContentDays();
          setDataMessage(`notes folder reconnected: ${handle.name}`);
        } catch (error) {
          console.warn("Tab Pad folder re-grant failed", error);
        }
      })();
    };

    window.addEventListener("pointerdown", tryRegrant, { once: true, capture: true });
    window.addEventListener("keydown", tryRegrant, { once: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", tryRegrant, { capture: true });
      window.removeEventListener("keydown", tryRegrant, { capture: true });
    };
  }, [loaded, mirrorStatus, refreshContentDays, syncFolderNow]);

  // keep the mirror folder self-describing for agents: which surfaces are on,
  // what today is, and how to write via the inbox
  useEffect(() => {
    if (!loaded || mirrorStatus !== "connected") return;
    const handle = mirrorHandleRef.current;
    if (!handle) return;
    // the scratchpad is now a widget — the manifest reflects whether its
    // widget is enabled, not the retired settings.scratchpad toggle
    const scratchpadOn = widgets.some((w) => w.id === "scratchpad" && w.enabled);
    void writeAgentFiles(handle, { margins: showDayMargins, scratchpad: scratchpadOn }, todayKey).catch((error) =>
      console.warn("Tab Pad agent manifest write failed", error),
    );
  }, [loaded, mirrorStatus, showDayMargins, widgets, todayKey]);

  const saveSettingsAndBroadcast = useCallback(async (patch: Partial<Settings>) => {
    const settings = await saveSettings(patch);
    applySettingsState(settings);
    void refreshMirrorState();
    channelRef.current?.post({ type: "settings", key: "settings", updatedAt: Date.now() });
    return settings;
  }, [applySettingsState, refreshMirrorState]);

  const changeSettings = useCallback(
    (patch: Partial<Settings>) => {
      // scratchpad is retained in the Settings type for backward compat but is
      // no longer a live UI toggle — its value is left untouched here
      applySettingsState({ theme: themePreference, accent, scratchpad: true, margins: showDayMargins, weekStartsOn, editorSize, font, ...patch });
      if (!loaded) return;

      void saveSettingsAndBroadcast(patch);
    },
    [
      accent,
      applySettingsState,
      editorSize,
      font,
      loaded,
      showDayMargins,
      saveSettingsAndBroadcast,
      themePreference,
      weekStartsOn,
    ],
  );

  const requestStoragePersistence = useCallback(() => {
    if (storagePersistRequested.current) return;
    storagePersistRequested.current = true;
    void navigator.storage?.persist?.().catch(() => undefined);
  }, []);

  // mirror flushes ride the same serialization chain as sync passes: a flush
  // can't interleave with a reconcile of the same file, and erase's await of
  // the chain quiesces in-flight flushes before it deletes files
  const flushMirrorDay = useCallback((row: DayRow | null) => {
    if (!row || mirrorStatus !== "connected" || erasingRef.current) return Promise.resolve();
    const run = async () => {
      if (erasingRef.current) return;
      const handle = mirrorHandleRef.current;
      if (!handle) return;
      try {
        await writeDayMirror(handle, row);
        syncFailures.current = 0;
      } catch (error) {
        console.warn("Tab Pad mirror day write failed", error);
        // permission loss is definitive; transient write errors get 3 strikes
        if (isMirrorPermissionError(error)) setMirrorStatus("reconnect");
        else if ((syncFailures.current += 1) >= 3) setMirrorStatus("error");
      }
    };
    const result = syncChainRef.current.then(run, run);
    syncChainRef.current = result.catch(() => undefined);
    return result;
  }, [mirrorStatus]);

  const queueMirrorDay = useCallback((row: DayRow | null) => {
    // an in-flight save's completion must not re-arm a timer mid-erase and
    // write the old note back into the just-emptied folder
    if (!row || mirrorStatus !== "connected" || erasingRef.current) return;
    const current = mirrorDayTimers.current.get(row.date);
    if (current) window.clearTimeout(current.timer);
    const timer = window.setTimeout(() => {
      mirrorDayTimers.current.delete(row.date);
      void flushMirrorDay(row);
    }, 800);
    mirrorDayTimers.current.set(row.date, { timer, row });
  }, [flushMirrorDay, mirrorStatus]);

  const flushMirrorPanel = useCallback((panel: PanelRow) => {
    if (mirrorStatus !== "connected" || erasingRef.current) return Promise.resolve();
    const run = async () => {
      if (erasingRef.current) return;
      const handle = mirrorHandleRef.current;
      if (!handle) return;
      try {
        await writePanelMirror(handle, panel);
        syncFailures.current = 0;
      } catch (error) {
        console.warn("Tab Pad mirror panel write failed", error);
        if (isMirrorPermissionError(error)) setMirrorStatus("reconnect");
        else if ((syncFailures.current += 1) >= 3) setMirrorStatus("error");
      }
    };
    const result = syncChainRef.current.then(run, run);
    syncChainRef.current = result.catch(() => undefined);
    return result;
  }, [mirrorStatus]);

  const queueMirrorPanel = useCallback((panel: PanelRow) => {
    if (mirrorStatus !== "connected" || erasingRef.current) return;
    const current = mirrorPanelTimers.current.get(panel.id);
    if (current) window.clearTimeout(current.timer);
    const timer = window.setTimeout(() => {
      mirrorPanelTimers.current.delete(panel.id);
      void flushMirrorPanel(panel);
    }, 800);
    mirrorPanelTimers.current.set(panel.id, { timer, panel });
  }, [flushMirrorPanel, mirrorStatus]);

  // rail excerpts don't need to update per keystroke — refresh shortly after
  // typing pauses
  const contentRefreshTimer = useRef(0);
  const queueContentRefresh = useCallback(() => {
    window.clearTimeout(contentRefreshTimer.current);
    contentRefreshTimer.current = window.setTimeout(() => {
      void refreshContentDays();
    }, 500);
  }, [refreshContentDays]);

  // every keystroke saves immediately; per-day promise chains keep the
  // (read row → write row) steps of consecutive saves from interleaving
  const daySaveChains = useRef(new Map<string, Promise<unknown>>());
  const persistDay = useCallback((key: string, mirrorNow = false, field: "main" | "margin" | "both" = "both") => {
    // a save queued while an erase is running (here or in another tab) would
    // commit after the clear and silently resurrect the note
    if (!loadedRef.current || erasingRef.current) return Promise.resolve();
    requestStoragePersistence();
    const prev = daySaveChains.current.get(key) ?? Promise.resolve();
    const next = prev
      .then(() =>
        saveDayFields(key, {
          ...(field !== "margin" ? { main: dayTextsRef.current[key] ?? "" } : {}),
          ...(field !== "main" ? { margin: dayMarginsRef.current[key] ?? "" } : {}),
        }),
      )
      .then((row) => {
        setSaveError(false);
        if (mirrorNow) void flushMirrorDay(row);
        else queueMirrorDay(row);
        channelRef.current?.post({ type: "day", key, updatedAt: row?.updatedAt ?? Date.now() });
      })
      .catch((error) => {
        console.warn("Tab Pad save failed", error);
        setSaveError(true);
      });
    daySaveChains.current.set(key, next);
    return next;
  }, [flushMirrorDay, queueMirrorDay, requestStoragePersistence]);

  const changeDayText = useCallback((key: string, value: string) => {
    setDayTexts((current) => ({ ...current, [key]: value }));
    dayTextsRef.current = { ...dayTextsRef.current, [key]: value };
    void persistDay(key, false, "main");
    queueContentRefresh();
  }, [persistDay, queueContentRefresh]);

  const changeDayMargin = useCallback((key: string, value: string) => {
    setDayMargins((current) => ({ ...current, [key]: value }));
    dayMarginsRef.current = { ...dayMarginsRef.current, [key]: value };
    void persistDay(key, false, "margin");
    queueContentRefresh();
  }, [persistDay, queueContentRefresh]);

  // keep the ref current so the broadcast listener (bound once) can mirror
  // other tabs' edits through this tab's connection
  useEffect(() => {
    queueMirrorDayRef.current = queueMirrorDay;
  }, [queueMirrorDay]);

  const handleDayBlur = useCallback((key: string) => {
    void persistDay(key, true);
    nudgeSync();
  }, [nudgeSync, persistDay]);

  const handleDayMarginBlur = useCallback((key: string) => {
    void persistDay(key, true);
    nudgeSync();
  }, [nudgeSync, persistDay]);

  const handleDayFocusChange = useCallback((key: string, focused: boolean) => {
    focusedDayRef.current = focused ? key : null;
  }, []);

  const handleDayMarginFocusChange = useCallback((key: string, focused: boolean) => {
    focusedMarginRef.current = focused ? key : null;
  }, []);

  const togglePrivacy = useCallback(() => {
    setPrivacyMode((current) => !current);
  }, []);

  useEffect(() => {
    try {
      if (privacyMode) localStorage.setItem(PRIVACY_KEY, "1");
      else localStorage.removeItem(PRIVACY_KEY);
    } catch {
      // persistence is a convenience; the mode still works in this tab
    }
    // drop the caret so nothing keeps typing into hidden notes
    if (privacyMode) (document.activeElement as HTMLElement | null)?.blur?.();
  }, [privacyMode]);

  useEffect(() => {
    try {
      if (focusDayKey) localStorage.setItem(FOCUS_KEY, focusDayKey);
      else localStorage.removeItem(FOCUS_KEY);
    } catch {
      // persistence is a convenience; the mode still works in this tab
    }
  }, [focusDayKey]);

  // lock/unlock and focus/unfocus in one tab apply to every open tab
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === PRIVACY_KEY) setPrivacyMode(event.newValue === "1");
      if (event.key === FOCUS_KEY) {
        setFocusDayKey(event.newValue && dateFromKey(event.newValue) ? event.newValue : null);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const panelSaveChains = useRef(new Map<PanelRow["id"], Promise<unknown>>());
  const persistPanel = useCallback((id: PanelRow["id"], mirrorNow = false) => {
    // never write before the stored value has loaded — an early keystroke
    // would overwrite the saved note with a near-empty one. also never write
    // mid-erase — the save would land after the clear
    if (!loadedRef.current || erasingRef.current) return Promise.resolve();
    requestStoragePersistence();
    const prev = panelSaveChains.current.get(id) ?? Promise.resolve();
    const next = prev
      .then(() => savePanel(id, panelTextsRef.current[id] ?? ""))
      .then((panel) => {
        setSaveError(false);
        if (mirrorNow) void flushMirrorPanel(panel);
        else queueMirrorPanel(panel);
        channelRef.current?.post({ type: "panel", key: id, updatedAt: panel.updatedAt });
      })
      .catch((error) => {
        console.warn("Tab Pad panel save failed", error);
        setSaveError(true);
      });
    panelSaveChains.current.set(id, next);
    return next;
  }, [flushMirrorPanel, queueMirrorPanel, requestStoragePersistence]);

  const changePanelText = useCallback((id: PanelRow["id"], value: string) => {
    setPanelTexts((current) => ({ ...current, [id]: value }));
    panelTextsRef.current = { ...panelTextsRef.current, [id]: value };
    void persistPanel(id);
  }, [persistPanel]);

  useEffect(() => {
    // notes are already saved per keystroke; on hide, just push any pending
    // debounced folder-mirror writes out immediately. flush the SNAPSHOT the
    // timer holds — timers also exist for other tabs' relayed edits, and
    // re-saving those from this tab's text refs could write stale or empty
    // content into the shared database
    const flushOnHide = () => {
      if (document.visibilityState !== "hidden") return;

      for (const [key, pending] of mirrorDayTimers.current) {
        window.clearTimeout(pending.timer);
        mirrorDayTimers.current.delete(key);
        void flushMirrorDay(pending.row);
      }
      for (const [id, pending] of mirrorPanelTimers.current) {
        window.clearTimeout(pending.timer);
        mirrorPanelTimers.current.delete(id);
        void flushMirrorPanel(pending.panel);
      }
      if (mirrorWidgetsTimer.current) {
        window.clearTimeout(mirrorWidgetsTimer.current);
        mirrorWidgetsTimer.current = 0;
        void flushMirrorWidgets();
      }
    };
    document.addEventListener("visibilitychange", flushOnHide);
    return () => document.removeEventListener("visibilitychange", flushOnHide);
  }, [flushMirrorDay, flushMirrorPanel, flushMirrorWidgets]);

  const exportJson = async () => {
    const payload = await createExportPayload();
    const blob = new Blob([serializeExport(payload)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tab-pad-export-${todayKey}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setDataMessage(`exported ${payload.days.length} days`);
  };

  const eraseEverything = async () => {
    const hasFolder = mirrorHandleRef.current !== null && mirrorStatus === "connected";
    const confirmed = window.confirm(
      hasFolder
        ? "erase all notes and scratchpad content? this also deletes the note files in your notes folder. a backup file will be downloaded first. this cannot be undone. (settings are kept.)"
        : "erase all notes and scratchpad content from this browser? a backup file will be downloaded first. this cannot be undone. (settings are kept.)",
    );
    if (!confirmed) return;
    // last-chance recovery: hand the user a full export before destroying data
    let backupFailed = false;
    try {
      await exportJson();
    } catch (error) {
      console.warn("Tab Pad pre-erase backup failed", error);
      if (!window.confirm("the backup download failed — erase anyway?")) return;
      backupFailed = true;
    }
    let folderEraseFailed = false;
    let dbEraseFailed = false;
    erasingRef.current = true;
    // tell other tabs BEFORE deleting anything, so their pending saves and
    // mirror timers can't recreate notes mid-erase
    channelRef.current?.post({ type: "erase", key: "all", updatedAt: Date.now() });
    // cancel pending mirror writes synchronously — before any await — so a
    // queued debounce timer can't fire mid-erase and recreate a file
    for (const pending of mirrorDayTimers.current.values()) window.clearTimeout(pending.timer);
    for (const pending of mirrorPanelTimers.current.values()) window.clearTimeout(pending.timer);
    mirrorDayTimers.current.clear();
    mirrorPanelTimers.current.clear();
    window.clearTimeout(mirrorWidgetsTimer.current);
    mirrorWidgetsTimer.current = 0;
    try {
      // let in-flight keystroke saves commit before the clear — a save that
      // commits after db.days.clear() would silently resurrect its row
      await Promise.allSettled([...daySaveChains.current.values(), ...panelSaveChains.current.values()]);
      // those saves' completions may have re-armed mirror timers before the
      // erasingRef guard existed in their closure — cancel again
      for (const pending of mirrorDayTimers.current.values()) window.clearTimeout(pending.timer);
      for (const pending of mirrorPanelTimers.current.values()) window.clearTimeout(pending.timer);
      mirrorDayTimers.current.clear();
      mirrorPanelTimers.current.clear();
      window.clearTimeout(mirrorWidgetsTimer.current);
      mirrorWidgetsTimer.current = 0;
      // let any in-flight sync or mirror flush finish, then block new ones
      await syncChainRef.current.catch(() => undefined);
      // the folder is the source of truth — erase the FILES first, then the
      // database, so no sync window can restore notes from leftover files
      const handle = mirrorHandleRef.current;
      if (handle) {
        try {
          await eraseMirrorFiles(handle);
        } catch (error) {
          console.warn("Tab Pad folder erase failed", error);
          folderEraseFailed = true;
        }
      }
      await eraseAllNotes();
      syncMtimes.current = new Map();
      setDayTexts({});
      setDayMargins({});
      setPanelTexts({ scratchpad: "" } as Record<PanelRow["id"], string>);
      dayTextsRef.current = {};
      dayMarginsRef.current = {};
      panelTextsRef.current = { scratchpad: "" } as Record<PanelRow["id"], string>;
    } catch (error) {
      // swallow so the post-erase steps below always run — other tabs are
      // frozen in erase mode until they hear "import"
      console.warn("Tab Pad erase failed", error);
      dbEraseFailed = true;
    } finally {
      erasingRef.current = false;
    }
    // other tabs stay frozen in erase mode until they hear "import" — a
    // failed reload here must not keep it from being posted
    try {
      await loadDocuments();
    } catch (error) {
      console.warn("Tab Pad post-erase reload failed", error);
    }
    channelRef.current?.post({ type: "import", key: "all", updatedAt: Date.now() });
    setDataMessage(
      dbEraseFailed
        ? `erase failed — some notes may remain${backupFailed ? "" : " (your backup was downloaded)"}`
        : folderEraseFailed
          ? "notes erased here, but some files in the notes folder could not be removed — they may come back"
          : "all notes erased",
    );
  };

  const importJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text()) as unknown;
      const result = await importPayload(payload);
      // imported days must reach the folder too, or agents never see them and
      // a later file write would erase them
      const handle = mirrorHandleRef.current;
      if (handle && mirrorStatus === "connected") {
        await writeFullMirror(handle).catch((error) => console.warn("Tab Pad post-import mirror failed", error));
      }
      await loadDocuments();
      channelRef.current?.post({ type: "import", key: "all", updatedAt: Date.now() });
      setDataMessage(`imported ${result.daysImported} days, ${result.panelsImported} panels, ${result.widgetsImported} widgets`);
    } catch (error) {
      console.warn("Tab Pad import failed", error);
      setDataMessage("import failed: not a valid tab pad export");
    }
  };

  const enableMirror = async () => {
    if (!isMirrorSupported()) {
      setDataMessage("folder sync isn't supported in this browser");
      return;
    }
    try {
      const handle = await pickMirrorDirectory();
      mirrorHandleRef.current = handle;
      setMirrorName(handle.name);
      setMirrorStatus("connected");
      syncFailures.current = 0;
      // a new folder is a new world — stale mtimes from the old one must not
      // suppress imports. swap the Map instance instead of clearing it: an
      // in-flight pass over the old folder still holds (and repopulates) the
      // old one, and day filenames collide across folders by construction
      syncMtimes.current = new Map();
      // pull anything already in the folder first, then push the full state
      await syncFolderNow(handle);
      await writeFullMirror(handle);
      await refreshContentDays();
      // tell other open tabs the folder changed so they start mirroring too
      channelRef.current?.post({ type: "settings", key: "settings", updatedAt: Date.now() });
      setDataMessage(`notes folder: ${handle.name}`);
    } catch (error) {
      // cancelling the picker isn't a failure — restore the true status
      if (error instanceof DOMException && error.name === "AbortError") {
        void refreshMirrorState();
        return;
      }
      console.warn("Tab Pad mirror setup failed", error);
      setMirrorStatus(isMirrorPermissionError(error) ? "reconnect" : "error");
    }
  };

  const reconnectMirror = async () => {
    try {
      let handle = mirrorHandleRef.current ?? (await getMirrorDirectory());
      const permission = handle ? await requestMirrorPermission(handle) : "denied";
      if (!handle || permission !== "granted") {
        // the re-grant didn't come through — fall back to picking the folder
        // again, which always works from a click
        handle = await pickMirrorDirectory();
      }

      mirrorHandleRef.current = handle;
      setMirrorName(handle.name);
      setMirrorStatus("connected");
      syncFailures.current = 0;
      // swap, don't clear — see enableMirror
      syncMtimes.current = new Map();
      // pull external edits first (last write wins), then push the full state
      await syncFolderNow(handle);
      await writeFullMirror(handle);
      await refreshContentDays();
      channelRef.current?.post({ type: "settings", key: "settings", updatedAt: Date.now() });
      setDataMessage(`notes folder: ${handle.name}`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        void refreshMirrorState();
        return;
      }
      console.warn("Tab Pad folder reconnect failed", error);
      setMirrorStatus(isMirrorPermissionError(error) ? "reconnect" : "error");
    }
  };

  const jumpToDate = useCallback((date: Date) => {
    if (!Number.isFinite(date.getTime())) return;
    // cap jumps at ±10 years — an extreme date would mount one DOM section per
    // day between here and there and hang the tab
    const distance = daysBetween(today, date);
    const clamped = Math.abs(distance) > 3650 ? addDays(today, Math.sign(distance) * 3650) : date;
    // any jump leaves focus mode — the target would otherwise be hidden
    setFocusDayKey(null);
    setJumpTarget({ date: clamped, id: Date.now() });
  }, [today]);

  // the Timeline restores the scroll position to this day itself on exit
  const toggleFocusDay = useCallback((key: string) => {
    setFocusDayKey((current) => (current === key ? null : key));
  }, []);

  // Escape leaves focus mode
  useEffect(() => {
    if (!focusDayKey) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") toggleFocusDay(focusDayKey);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusDayKey, toggleFocusDay]);

  // a hidden tab can't be typed in: release focus guards so cross-tab
  // broadcasts keep this tab's copies fresh while it's in the background
  useEffect(() => {
    const onWindowBlur = () => {
      focusedDayRef.current = null;
      focusedMarginRef.current = null;
      focusedPanelRef.current = null;
    };
    const onWindowFocus = () => {
      if (!loadedRef.current) return;
      void (async () => {
        // pick up file edits made while this tab was in the background
        try {
          const handle = mirrorHandleRef.current;
          if (handle && (await queryMirrorPermission(handle)) === "granted") {
            await syncFolderNow(handle);
          }
        } catch (error) {
          console.warn("Tab Pad folder sync failed", error);
        }
        await refreshContentDays();
      })();
    };
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onWindowFocus);
    return () => {
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("focus", onWindowFocus);
    };
  }, [refreshContentDays]);

  const fixedPanelId: PanelRow["id"] = "scratchpad";
  // the right rail is present whenever any enabled widget lives in it
  const hasRightRail = widgets.some((w) => w.enabled && sanitizeColumn(w.column) === "right");

  const widgetContext: WidgetContext = useMemo(
    () => ({
      data: { today, todayKey: dateKey(today), todayText, contentDays },
      weekStartsOn,
      currentTopKey,
      privacyMode,
      onJumpToDate: jumpToDate,
      scratchpad: {
        value: panelTexts[fixedPanelId],
        onChange: (value) => changePanelText(fixedPanelId, value),
        onBlur: () => {
          void persistPanel(fixedPanelId, true);
          nudgeSync();
        },
        onFocusChange: (focused) => {
          focusedPanelRef.current = focused ? fixedPanelId : null;
        },
      },
    }),
    [today, todayText, contentDays, weekStartsOn, currentTopKey, privacyMode, jumpToDate, panelTexts, changePanelText, persistPanel, nudgeSync],
  );

  const shellClassName = [
    "app-shell",
    hasRightRail ? "has-right-rail" : "",
    showDayMargins ? "has-margins" : "",
    focusDayKey ? "focus-mode" : "",
    privacyMode ? "privacy-mode" : "",
    `editor-size-${editorSize}`,
    `font-${font}`,
  ].filter(Boolean).join(" ");

  return (
    <main className={shellClassName} data-theme={resolvedTheme}>
      <Rail
        widgets={widgets}
        widgetFileIssues={widgetFileIssues}
        context={widgetContext}
        mirrorStatus={mirrorStatus}
        privacyMode={privacyMode}
        onOpenSettings={() => setSettingsOpen(true)}
        onReconnectMirror={() => void reconnectMirror()}
        onTogglePrivacy={togglePrivacy}
      />
      {/* mount editors only after stored notes are loaded — the today editor
          autofocuses on mount, and a focused editor refuses external content,
          so mounting early would show (and then save) an empty note */}
      {loaded ? (
      <Timeline
        today={today}
        dayTexts={dayTexts}
        dayMargins={dayMargins}
        contentDays={contentDays}
        jumpTarget={jumpTarget}
        showMargins={showDayMargins}
        layoutMode={`${hasRightRail}-${showDayMargins}`}
        focusDayKey={focusDayKey}
        privacyMode={privacyMode}
        onToggleFocusDay={toggleFocusDay}
        onDayTextChange={changeDayText}
        onDayMarginChange={changeDayMargin}
        onDayBlur={handleDayBlur}
        onDayMarginBlur={handleDayMarginBlur}
        onDayFocusChange={handleDayFocusChange}
        onDayMarginFocusChange={handleDayMarginFocusChange}
        onTopDateChange={setCurrentTopKey}
      />
      ) : (
        <section className="timeline" aria-label="daily notes" />
      )}
      <CommandK today={today} onJumpToDate={jumpToDate} />
      <SettingsOverlay
        open={settingsOpen}
        theme={themePreference}
        accent={accent}
        margins={showDayMargins}
        weekStartsOn={weekStartsOn}
        editorSize={editorSize}
        font={font}
        mirrorStatus={mirrorStatus}
        mirrorName={mirrorName}
        dataMessage={dataMessage}
        privacyMode={privacyMode}
        widgets={widgets}
        onWidgetToggle={handleWidgetToggle}
        onWidgetMove={handleWidgetMove}
        onWidgetDelete={handleWidgetDelete}
        onWidgetSave={handleWidgetSave}
        onClose={() => setSettingsOpen(false)}
        onThemeChange={(theme) => changeSettings({ theme })}
        onAccentChange={(accent) => changeSettings({ accent })}
        onMarginsChange={(margins) => changeSettings({ margins })}
        onWeekStartsOnChange={(weekStartsOn) => changeSettings({ weekStartsOn })}
        onEditorSizeChange={(editorSize) => changeSettings({ editorSize })}
        onFontChange={(font) => changeSettings({ font })}
        onEnableMirror={() => void enableMirror()}
        onReconnectMirror={() => void reconnectMirror()}
        onExport={() => void exportJson()}
        onImport={(file) => void importJson(file)}
        onEraseAll={() => void eraseEverything()}
      />
      {saveError ? (
        <div className="save-error-banner" role="alert">
          saving is failing — export your notes from settings now
        </div>
      ) : null}
      {loaded && (mirrorStatus === "reconnect" || mirrorStatus === "error") ? (
        <button className="sync-banner" type="button" onClick={() => void reconnectMirror()}>
          notes folder disconnected — click to reconnect
        </button>
      ) : null}
      {loaded ? <RightRail widgets={widgets} context={widgetContext} /> : null}
    </main>
  );
}
