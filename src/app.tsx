import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createDaybookChannel, type DaybookChannel } from "./db/broadcast";
import type { DayRow, PanelRow, Settings } from "./db/db";
import { appendToDay, eraseAllNotes, getDay, listContentDays, saveDayFields } from "./db/days";
import { createExportPayload, importPayload, serializeExport } from "./db/export";
import { appendToPanel, getPanel, savePanel } from "./db/panels";
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
import { RightPanel } from "./panel/RightPanel";
import { Rail } from "./rail/Rail";
import { SettingsOverlay } from "./settings/SettingsOverlay";
import { Timeline, type JumpTarget } from "./timeline/Timeline";
import { useToday } from "./timeline/useToday";
import {
  getMirrorDirectory,
  isMirrorPermissionError,
  pickMirrorDirectory,
  queryMirrorPermission,
  queryMirrorStatus,
  readInbox,
  removeInboxEntry,
  requestMirrorPermission,
  type FileSystemDirectoryHandleLike,
  type MirrorStatus,
  writeAgentFiles,
  writeDayMirror,
  writeFullMirror,
  writePanelMirror,
} from "./mirror/mirror";

// agents drop .md files in the mirror's inbox/ — append each to its target,
// re-mirror the result, and delete the file (the deletion is the receipt)
async function processInbox(handle: FileSystemDirectoryHandleLike): Promise<number> {
  const entries = await readInbox(handle);
  let applied = 0;
  for (const entry of entries) {
    const marginMatch = /^(\d{4}-\d{2}-\d{2})\.margin\.md$/.exec(entry.name);
    const dayMatch = /^(\d{4}-\d{2}-\d{2})\.md$/.exec(entry.name);
    try {
      if (marginMatch && dateFromKey(marginMatch[1])) {
        const row = await appendToDay(marginMatch[1], "margin", entry.text);
        if (row) await writeDayMirror(handle, row);
      } else if (dayMatch && dateFromKey(dayMatch[1])) {
        const row = await appendToDay(dayMatch[1], "main", entry.text);
        if (row) await writeDayMirror(handle, row);
      } else if (entry.name === "scratchpad.md") {
        const panel = await appendToPanel("scratchpad", entry.text);
        await writePanelMirror(handle, panel);
      } else {
        continue; // unknown filename: leave it for the human to inspect
      }
      await removeInboxEntry(handle, entry.name);
      applied += 1;
    } catch (error) {
      console.warn("Tab Pad inbox entry failed", entry.name, error);
    }
  }
  return applied;
}

export function App() {
  const today = useToday();
  const todayKey = dateKey(today);
  const channelRef = useRef<DaybookChannel | null>(null);
  const focusedDayRef = useRef<string | null>(null);
  const focusedMarginRef = useRef<string | null>(null);
  const focusedPanelRef = useRef<PanelRow["id"] | null>(null);
  const dayTextsRef = useRef<Record<string, string>>({});
  const dayMarginsRef = useRef<Record<string, string>>({});
  const panelTextsRef = useRef<Record<PanelRow["id"], string>>({ scratchpad: "" } as Record<PanelRow["id"], string>);
  const mirrorHandleRef = useRef<FileSystemDirectoryHandleLike | null>(null);
  const storagePersistRequested = useRef(false);
  const mirrorDayTimers = useRef(new Map<string, number>());
  const mirrorPanelTimers = useRef(new Map<PanelRow["id"], number>());
  const lastKeyJumpRef = useRef<string | null>(null);

  const [themePreference, setThemePreference] = useState<ThemePreference>(() => readThemePreference());
  const [accent, setAccent] = useState<AccentColor>(() => readAccentPreference());
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => currentSystemTheme());
  const [weekStartsOn, setWeekStartsOn] = useState<0 | 1>(0);
  const [showScratchpad, setShowScratchpad] = useState(true);
  const [showDayMargins, setShowDayMargins] = useState(false);
  const [editorSize, setEditorSize] = useState<Settings["editorSize"]>("md");
  const [font, setFont] = useState<Settings["font"]>("sans");
  const [mirrorEnabled, setMirrorEnabled] = useState(false);
  const [mirrorStatus, setMirrorStatus] = useState<MirrorStatus>("off");
  const [mirrorName, setMirrorName] = useState("");
  const [dayTexts, setDayTexts] = useState<Record<string, string>>({});
  const [dayMargins, setDayMargins] = useState<Record<string, string>>({});
  const [panelTexts, setPanelTexts] = useState<Record<PanelRow["id"], string>>({ scratchpad: "" } as Record<PanelRow["id"], string>);
  const [contentDays, setContentDays] = useState<DayRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);
  const [saveError, setSaveError] = useState(false);
  const [dataMessage, setDataMessage] = useState("");
  const [jumpTarget, setJumpTarget] = useState<JumpTarget | null>(null);
  const [currentTopKey, setCurrentTopKey] = useState(todayKey);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const resolvedTheme = resolveTheme(themePreference, systemTheme);
  const todayText = dayTexts[todayKey] ?? "";

  useLayoutEffect(() => {
    if (!performance.getEntriesByName("daybook:shell-ready").length) {
      performance.mark("daybook:shell-ready");
    }
  }, []);

  useEffect(() => {
    if (!loaded || performance.getEntriesByName("daybook:today-content-ready").length) return;
    if (document.querySelector(".day-section.today .cm-content")) {
      performance.mark("daybook:today-content-ready");
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
    setShowScratchpad(settings.scratchpad);
    setShowDayMargins(settings.margins);
    setEditorSize(settings.editorSize);
    setFont(settings.font);
    setMirrorEnabled(settings.mirrorEnabled);
  }, []);

  const refreshMirrorState = useCallback(async (enabled: boolean) => {
    if (!enabled) {
      mirrorHandleRef.current = null;
      setMirrorName("");
      setMirrorStatus("off");
      return null;
    }

    const handle = await getMirrorDirectory();
    mirrorHandleRef.current = handle;
    setMirrorName(handle?.name ?? "");
    const status = await queryMirrorStatus(handle);
    setMirrorStatus(status);
    return handle;
  }, []);

  const refreshContentDays = useCallback(async () => {
    const rows = await listContentDays();
    setContentDays(rows);
    setDayTexts((current) => {
      const next = { ...current };
      for (const row of rows) {
        if (focusedDayRef.current !== row.date) {
          next[row.date] = row.main;
        }
      }
      return next;
    });
    setDayMargins((current) => {
      const next = { ...current };
      for (const row of rows) {
        if (focusedMarginRef.current !== row.date) {
          next[row.date] = row.margin;
        }
      }
      return next;
    });
  }, []);

  const loadDocuments = useCallback(async () => {
    // apply agent inbox entries first so they're part of what loads below
    try {
      const early = await getSettings();
      if (early.mirrorEnabled) {
        const handle = await getMirrorDirectory();
        if (handle && (await queryMirrorPermission(handle)) === "granted") {
          const applied = await processInbox(handle);
          if (applied > 0) {
            setDataMessage(`added ${applied} note${applied > 1 ? "s" : ""} from the inbox`);
          }
        }
      }
    } catch (error) {
      console.warn("Tab Pad inbox check failed", error);
    }

    const [day, scratchpad, settings, rows] = await Promise.all([
      getDay(todayKey),
      getPanel("scratchpad"),
      getSettings(),
      listContentDays(),
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
    void refreshMirrorState(settings.mirrorEnabled);
    setContentDays(rows);
    loadedRef.current = true;
    setLoaded(true);
  }, [applySettingsState, refreshMirrorState, todayKey]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    const channel = createDaybookChannel();
    channelRef.current = channel;
    const stop = channel.listen((message) => {
      if (message.type === "day") {
        void getDay(message.key).then((row) => {
          // re-check focus at apply time — it may have moved during the read
          setDayTexts((current) =>
            focusedDayRef.current === message.key ? current : { ...current, [message.key]: row?.main ?? "" },
          );
          setDayMargins((current) =>
            focusedMarginRef.current === message.key ? current : { ...current, [message.key]: row?.margin ?? "" },
          );
        });
      }
      if (message.type === "panel" && message.key === "scratchpad") {
        void getPanel(message.key).then((panel) => {
          setPanelTexts((current) =>
            focusedPanelRef.current === message.key ? current : { ...current, [message.key]: panel.content },
          );
        });
      }
      if (message.type === "settings") {
        void getSettings().then((settings) => {
          applySettingsState(settings);
          void refreshMirrorState(settings.mirrorEnabled);
        });
      }
      if (message.type === "import") {
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
  }, [applySettingsState, loadDocuments, refreshContentDays, refreshMirrorState, todayKey]);

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

  // keep the mirror folder self-describing for agents: which surfaces are on,
  // what today is, and how to write via the inbox
  useEffect(() => {
    if (!loaded || !mirrorEnabled || mirrorStatus !== "connected") return;
    const handle = mirrorHandleRef.current;
    if (!handle) return;
    void writeAgentFiles(handle, { margins: showDayMargins, scratchpad: showScratchpad }, todayKey).catch((error) =>
      console.warn("Tab Pad agent manifest write failed", error),
    );
  }, [loaded, mirrorEnabled, mirrorStatus, showDayMargins, showScratchpad, todayKey]);

  const saveSettingsAndBroadcast = useCallback(async (patch: Partial<Settings>) => {
    const settings = await saveSettings(patch);
    applySettingsState(settings);
    void refreshMirrorState(settings.mirrorEnabled);
    channelRef.current?.post({ type: "settings", key: "settings", updatedAt: Date.now() });
    return settings;
  }, [applySettingsState, refreshMirrorState]);

  const changeSettings = useCallback(
    (patch: Partial<Settings>) => {
      applySettingsState({ theme: themePreference, accent, scratchpad: showScratchpad, margins: showDayMargins, weekStartsOn, editorSize, font, mirrorEnabled, ...patch });
      if (!loaded) return;

      void saveSettingsAndBroadcast(patch);
    },
    [
      accent,
      applySettingsState,
      editorSize,
      font,
      loaded,
      mirrorEnabled,
      showDayMargins,
      showScratchpad,
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

  const flushMirrorDay = useCallback(async (row: DayRow | null) => {
    if (!row || !mirrorEnabled || mirrorStatus !== "connected") return;
    const handle = mirrorHandleRef.current;
    if (!handle) return;

    try {
      await writeDayMirror(handle, row);
    } catch (error) {
      console.warn("Daybook mirror day write failed", error);
      setMirrorStatus(isMirrorPermissionError(error) ? "reconnect" : "error");
    }
  }, [mirrorEnabled, mirrorStatus]);

  const queueMirrorDay = useCallback((row: DayRow | null) => {
    if (!row || !mirrorEnabled || mirrorStatus !== "connected") return;
    const current = mirrorDayTimers.current.get(row.date);
    if (current) window.clearTimeout(current);
    const next = window.setTimeout(() => {
      mirrorDayTimers.current.delete(row.date);
      void flushMirrorDay(row);
    }, 800);
    mirrorDayTimers.current.set(row.date, next);
  }, [flushMirrorDay, mirrorEnabled, mirrorStatus]);

  const flushMirrorPanel = useCallback(async (panel: PanelRow) => {
    if (!mirrorEnabled || mirrorStatus !== "connected") return;
    const handle = mirrorHandleRef.current;
    if (!handle) return;

    try {
      await writePanelMirror(handle, panel);
    } catch (error) {
      console.warn("Daybook mirror panel write failed", error);
      setMirrorStatus(isMirrorPermissionError(error) ? "reconnect" : "error");
    }
  }, [mirrorEnabled, mirrorStatus]);

  const queueMirrorPanel = useCallback((panel: PanelRow) => {
    if (!mirrorEnabled || mirrorStatus !== "connected") return;
    const current = mirrorPanelTimers.current.get(panel.id);
    if (current) window.clearTimeout(current);
    const next = window.setTimeout(() => {
      mirrorPanelTimers.current.delete(panel.id);
      void flushMirrorPanel(panel);
    }, 800);
    mirrorPanelTimers.current.set(panel.id, next);
  }, [flushMirrorPanel, mirrorEnabled, mirrorStatus]);

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
    if (!loadedRef.current) return Promise.resolve();
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
        console.warn("Daybook save failed", error);
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

  const handleDayBlur = useCallback((key: string) => {
    void persistDay(key, true);
  }, [persistDay]);

  const handleDayMarginBlur = useCallback((key: string) => {
    void persistDay(key, true);
  }, [persistDay]);

  const handleDayFocusChange = useCallback((key: string, focused: boolean) => {
    focusedDayRef.current = focused ? key : null;
  }, []);

  const handleDayMarginFocusChange = useCallback((key: string, focused: boolean) => {
    focusedMarginRef.current = focused ? key : null;
  }, []);

  const panelSaveChains = useRef(new Map<PanelRow["id"], Promise<unknown>>());
  const persistPanel = useCallback((id: PanelRow["id"], mirrorNow = false) => {
    // never write before the stored value has loaded — an early keystroke
    // would overwrite the saved note with a near-empty one
    if (!loadedRef.current) return Promise.resolve();
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
        console.warn("Daybook panel save failed", error);
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
    // debounced folder-mirror writes out immediately
    const flushOnHide = () => {
      if (document.visibilityState !== "hidden") return;

      for (const [key, timer] of mirrorDayTimers.current) {
        window.clearTimeout(timer);
        mirrorDayTimers.current.delete(key);
        void persistDay(key, true);
      }
      for (const [id, timer] of mirrorPanelTimers.current) {
        window.clearTimeout(timer);
        mirrorPanelTimers.current.delete(id);
        void persistPanel(id, true);
      }
    };
    document.addEventListener("visibilitychange", flushOnHide);
    return () => document.removeEventListener("visibilitychange", flushOnHide);
  }, [persistDay, persistPanel]);

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
    const confirmed = window.confirm(
      "erase all notes and scratchpad content from this browser? this cannot be undone. (settings are kept.)",
    );
    if (!confirmed) return;
    await eraseAllNotes();
    setDayTexts({});
    setDayMargins({});
    setPanelTexts({ scratchpad: "" } as Record<PanelRow["id"], string>);
    dayTextsRef.current = {};
    dayMarginsRef.current = {};
    panelTextsRef.current = { scratchpad: "" } as Record<PanelRow["id"], string>;
    await loadDocuments();
    channelRef.current?.post({ type: "import", key: "all", updatedAt: Date.now() });
    setDataMessage("all notes erased");
  };

  const importJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text()) as unknown;
      const result = await importPayload(payload);
      await loadDocuments();
      channelRef.current?.post({ type: "import", key: "all", updatedAt: Date.now() });
      setDataMessage(`imported ${result.daysImported} days, ${result.panelsImported} panels`);
    } catch (error) {
      console.warn("Daybook import failed", error);
      setDataMessage("import failed: not a valid tab pad export");
    }
  };

  const enableMirror = async () => {
    try {
      const handle = await pickMirrorDirectory();
      mirrorHandleRef.current = handle;
      setMirrorName(handle.name);
      setMirrorStatus("connected");
      await writeFullMirror(handle);
      await saveSettingsAndBroadcast({ mirrorEnabled: true });
      setDataMessage(`mirror connected to ${handle.name}`);
    } catch (error) {
      console.warn("Daybook mirror setup failed", error);
      setMirrorStatus(isMirrorPermissionError(error) ? "reconnect" : "error");
    }
  };

  const disableMirror = async () => {
    await saveSettingsAndBroadcast({ mirrorEnabled: false });
    mirrorHandleRef.current = null;
    setMirrorName("");
    setMirrorStatus("off");
    setDataMessage("folder mirror off");
  };

  const reconnectMirror = async () => {
    try {
      const handle = mirrorHandleRef.current ?? (await getMirrorDirectory());
      if (!handle) {
        setMirrorStatus("reconnect");
        return;
      }

      const permission = await requestMirrorPermission(handle);
      if (permission !== "granted") {
        setMirrorStatus("reconnect");
        return;
      }

      mirrorHandleRef.current = handle;
      setMirrorName(handle.name);
      setMirrorStatus("connected");
      await writeFullMirror(handle);
      setDataMessage(`mirror connected to ${handle.name}`);
    } catch (error) {
      console.warn("Daybook mirror reconnect failed", error);
      setMirrorStatus(isMirrorPermissionError(error) ? "reconnect" : "error");
    }
  };

  const jumpToDate = useCallback((date: Date) => {
    if (!Number.isFinite(date.getTime())) return;
    // cap jumps at ±10 years — an extreme date would mount one DOM section per
    // day between here and there and hang the tab
    const distance = daysBetween(today, date);
    const clamped = Math.abs(distance) > 3650 ? addDays(today, Math.sign(distance) * 3650) : date;
    setJumpTarget({ date: clamped, id: Date.now() });
  }, [today]);

  useEffect(() => {
    // only release the stepping base once the scroll has caught up with it —
    // intermediate positions during the smooth scroll must not reset it
    if (lastKeyJumpRef.current === currentTopKey) {
      lastKeyJumpRef.current = null;
    }
  }, [currentTopKey]);

  // a hidden tab can't be typed in: release focus guards so cross-tab
  // broadcasts keep this tab's copies fresh while it's in the background
  useEffect(() => {
    const onWindowBlur = () => {
      focusedDayRef.current = null;
      focusedMarginRef.current = null;
      focusedPanelRef.current = null;
    };
    const onWindowFocus = () => {
      if (loadedRef.current) void refreshContentDays();
    };
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onWindowFocus);
    return () => {
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("focus", onWindowFocus);
    };
  }, [refreshContentDays]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
      // inside an editor, shift+arrows must keep selecting text
      if ((event.target as HTMLElement)?.closest?.(".cm-editor, input, textarea, [contenteditable='true']")) return;

      // Shift+Up = one day forward (future is above today), Shift+Down = one day back
      if (event.code === "ArrowUp" || event.code === "ArrowDown") {
        // step from the last keyboard jump so rapid presses advance multiple
        // days even before the scroll position catches up
        const baseKey = lastKeyJumpRef.current ?? currentTopKey;
        const current = dateFromKey(baseKey) ?? today;
        const next = addDays(current, event.code === "ArrowUp" ? 1 : -1);
        lastKeyJumpRef.current = dateKey(next);
        event.preventDefault();
        event.stopPropagation();
        jumpToDate(next);
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [currentTopKey, jumpToDate, today]);

  const fixedPanelId: PanelRow["id"] = "scratchpad";
  const shellClassName = [
    "app-shell",
    showScratchpad ? "has-scratchpad" : "",
    showDayMargins ? "has-margins" : "",
    `editor-size-${editorSize}`,
    `font-${font}`,
  ].filter(Boolean).join(" ");

  return (
    <main className={shellClassName} data-theme={resolvedTheme}>
      <Rail
        today={today}
        todayText={todayText}
        contentDays={contentDays}
        weekStartsOn={weekStartsOn}
        currentTopKey={currentTopKey}
        mirrorEnabled={mirrorEnabled}
        mirrorStatus={mirrorStatus}
        onJumpToDate={jumpToDate}
        onOpenSettings={() => setSettingsOpen(true)}
        onReconnectMirror={() => void reconnectMirror()}
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
        layoutMode={`${showScratchpad}-${showDayMargins}`}
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
        scratchpad={showScratchpad}
        margins={showDayMargins}
        weekStartsOn={weekStartsOn}
        editorSize={editorSize}
        font={font}
        mirrorEnabled={mirrorEnabled}
        mirrorStatus={mirrorStatus}
        mirrorName={mirrorName}
        dataMessage={dataMessage}
        onClose={() => setSettingsOpen(false)}
        onThemeChange={(theme) => changeSettings({ theme })}
        onAccentChange={(accent) => changeSettings({ accent })}
        onScratchpadChange={(scratchpad) => changeSettings({ scratchpad })}
        onMarginsChange={(margins) => changeSettings({ margins })}
        onWeekStartsOnChange={(weekStartsOn) => changeSettings({ weekStartsOn })}
        onEditorSizeChange={(editorSize) => changeSettings({ editorSize })}
        onFontChange={(font) => changeSettings({ font })}
        onEnableMirror={() => void enableMirror()}
        onDisableMirror={() => void disableMirror()}
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
      {loaded ? (
      <RightPanel
        show={showScratchpad}
        value={panelTexts[fixedPanelId]}
        onValueChange={(value) => changePanelText(fixedPanelId, value)}
        onBlur={() => void persistPanel(fixedPanelId, true)}
        onFocusChange={(focused) => {
          focusedPanelRef.current = focused ? fixedPanelId : null;
        }}
      />
      ) : null}
    </main>
  );
}
