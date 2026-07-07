import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(".");
const dist = resolve("dist");
const profile = "/tmp/daybook-final-browser-profile";
const midnightProfile = "/tmp/daybook-final-midnight-profile";
const evidencePath = "/tmp/daybook-final-browser-evidence.json";
const port = 9234;
const candidates = [
  "/Users/tonym/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Users/tonym/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
];

const evidence = { checks: {}, notes: [] };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function fetchTargets() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
    } catch {
      await wait(100);
    }
  }
  throw new Error("Chrome for Testing DevTools endpoint did not open.");
}

function makeSender(ws, onEvent) {
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    onEvent?.(message);
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(`${callback.method}: ${message.error.message}`));
    else callback.resolve(message);
  });

  return function send(method, params = {}) {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveSend, reject) => {
      pending.set(id, { method, resolve: resolveSend, reject });
    });
  };
}

async function connectPage(target) {
  assert(target?.webSocketDebuggerUrl, "No page target was available from Chrome for Testing.");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    ws.addEventListener("open", resolveOpen, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const httpRequests = [];
  const send = makeSender(ws, (message) => {
    if (message.method !== "Network.requestWillBeSent") return;
    const url = message.params.request.url;
    if (url.startsWith("http://") || url.startsWith("https://")) httpRequests.push(url);
  });

  async function evaluate(expression, awaitPromise = false) {
    const result = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
    if (result.result.exceptionDetails) {
      throw new Error(result.result.exceptionDetails.text ?? "Runtime evaluation failed");
    }
    return result.result.result.value;
  }

  async function json(expression, awaitPromise = false) {
    return JSON.parse(await evaluate(`(() => JSON.stringify(${expression}))()`, awaitPromise));
  }

  async function asyncJson(expression) {
    return JSON.parse(await evaluate(`(async () => JSON.stringify(await (${expression})))()`, true));
  }

  async function waitFor(expression, label, timeoutMs = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await evaluate(expression)) return;
      await wait(60);
    }
    throw new Error(`Timed out waiting for ${label}.`);
  }

  async function waitForDaybookReady(label = "Daybook ready") {
    await waitFor(
      `document.title === "Tab Pad" && !!document.querySelector(".day-section.today .cm-content")`,
      label,
      5000,
    );
  }

  async function insertIntoEditor(selector, text) {
    await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("editor target missing");
      el.focus();
      document.execCommand("insertText", false, ${JSON.stringify(text)});
      return true;
    })()`);
    await wait(120);
  }

  async function waitForDayMain(date, predicate, label, timeoutMs = 4000) {
    const started = Date.now();
    let last = null;
    while (Date.now() - started < timeoutMs) {
      last = await getDay(date);
      if (predicate(last?.main ?? "")) return last;
      await wait(100);
    }
    throw new Error(`${label}. ${JSON.stringify({ date, main: last?.main ?? null })}`);
  }

  async function getDay(date) {
    return asyncJson(`new Promise((resolve, reject) => {
      const open = indexedDB.open("tabpad");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const req = open.result.transaction("days").objectStore("days").get(${JSON.stringify(date)});
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result || null);
      };
    })`);
  }

  async function readStore(name) {
    return asyncJson(`new Promise((resolve, reject) => {
      const open = indexedDB.open("tabpad");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const req = open.result.transaction(${JSON.stringify(name)}).objectStore(${JSON.stringify(name)}).getAll();
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result || []);
      };
    })`);
  }

  async function putRows(payload) {
    await evaluate(`new Promise((resolve, reject) => {
      const payload = ${JSON.stringify(payload)};
      const open = indexedDB.open("tabpad");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction(["days", "panels", "meta"], "readwrite");
        for (const row of payload.days) tx.objectStore("days").put(row);
        for (const row of payload.panels) tx.objectStore("panels").put(row);
        tx.objectStore("meta").put({ id: "settings", value: payload.settings });
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => resolve(true);
      };
    })`, true);
  }

  async function putSettings(settings) {
    await evaluate(`new Promise((resolve, reject) => {
      const open = indexedDB.open("tabpad");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction("meta", "readwrite");
        tx.objectStore("meta").put({ id: "settings", value: ${JSON.stringify(settings)} });
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => resolve(true);
      };
    })`, true);
  }

  return {
    ws,
    send,
    evaluate,
    json,
    asyncJson,
    waitFor,
    waitForDaybookReady,
    insertIntoEditor,
    waitForDayMain,
    getDay,
    readStore,
    putRows,
    putSettings,
    httpRequests,
    close: () => ws.close(),
  };
}

async function launchChrome(executable, userDataDir, startUrl = "chrome://newtab/") {
  const chrome = spawn(executable, [
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--use-mock-keychain",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    // headless by default (new headless renders extensions + layout faithfully)
    // so test runs don't pop a window and steal focus; HEADED=1 to watch a run
    ...(process.env.HEADED ? [] : ["--headless=new"]),
    "--window-size=1440,1000",
    startUrl,
  ], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });

  let stderr = "";
  chrome.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  return { chrome, stderr: () => stderr };
}

async function stopChrome(session) {
  if (!session?.chrome || session.chrome.killed) return;
  session.chrome.kill("SIGTERM");
  await new Promise((resolveExit) => session.chrome.once("exit", resolveExit));
}

async function firstDaybookPage() {
  // the DevTools endpoint comes up a beat before the extension's new-tab page
  // registers as a target (more pronounced under new headless), so poll for a
  // page target instead of grabbing the first fetch — otherwise we assert-fail
  // on the empty window between endpoint-ready and page-created
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const targets = await fetchTargets();
    const page = targets.find((target) => target.type === "page" && target.title === "Tab Pad")
      ?? targets.find((target) => target.type === "page");
    if (page?.webSocketDebuggerUrl) return connectPage(page);
    await wait(250);
  }
  return connectPage(undefined); // exhausted: let connectPage throw the clear error
}

async function main() {
  const executable = candidates.find((candidate) => existsSync(candidate));
  assert(executable, "Chrome for Testing is required for final browser verification.");
  assert(existsSync(resolve(dist, "manifest.json")), "dist/manifest.json is missing; run npm run build first.");

  rmSync(profile, { force: true, recursive: true });
  await mkdir(profile, { recursive: true });

  let session = await launchChrome(executable, profile);
  try {
    const page1 = await firstDaybookPage();
    await page1.send("Page.enable");
    await page1.send("Runtime.enable");
    await page1.send("Network.enable");
    await page1.waitForDaybookReady("first tab");
    const todayKey = await page1.evaluate(`document.querySelector(".day-section.today")?.dataset.date`);

    const targetResult = await page1.send("Target.createTarget", { url: "chrome://newtab/" });
    const targetId = targetResult.result.targetId;
    let page2Target = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      page2Target = (await fetchTargets()).find((target) => target.id === targetId);
      if (page2Target) break;
      await wait(100);
    }
    const page2 = await connectPage(page2Target);
    await page2.send("Page.enable");
    await page2.send("Runtime.enable");
    await page2.send("Network.enable");
    await page2.waitForDaybookReady("second tab");
    // unfocus the auto-focused today editor — a focused editor correctly
    // refuses remote overwrites, and the old .today-pill park target is gone
    await page2.evaluate(`document.activeElement?.blur()`);

    await page1.insertIntoEditor(".day-section.today .cm-content", "two tab sync");
    const syncedRow = await page1.waitForDayMain(todayKey, (main) => main.includes("two tab sync"), "A14: first tab edit must save");
    await page2.waitFor(`(document.querySelector(".day-section.today .cm-content")?.innerText ?? "").includes("two tab sync")`, "A14: second tab receives unfocused edit", 5000);
    const secondTabText = await page2.evaluate(`document.querySelector(".day-section.today .cm-content")?.innerText ?? ""`);
    evidence.checks.a14TwoTabs = { todayKey, syncedRow, secondTabText };

    const exportedSettings = { theme: "dark", rightPanel: "masterList", weekStartsOn: 1, editorSize: "lg", mirrorEnabled: false };
    await page1.putSettings(exportedSettings);
    const payload = {
      days: await page1.readStore("days"),
      panels: await page1.readStore("panels"),
      settings: (await page1.readStore("meta")).find((row) => row.id === "settings")?.value ?? null,
    };
    evidence.checks.a16ExportSnapshot = {
      days: payload.days.length,
      panels: payload.panels.length,
      settings: payload.settings,
      hasSyncedDay: payload.days.some((row) => row.date === todayKey && row.main.includes("two tab sync")),
    };
    assert(evidence.checks.a16ExportSnapshot.hasSyncedDay, "A16: browser export snapshot must include synced day.");
    assert(payload.settings?.theme === "dark" && payload.settings?.weekStartsOn === 1, "A16: browser export snapshot must include non-default settings.");

    page2.close();
    page1.close();
    await stopChrome(session);
    session = null;

    session = await launchChrome(executable, profile);
    const reopened = await firstDaybookPage();
    await reopened.send("Page.enable");
    await reopened.send("Runtime.enable");
    await reopened.waitForDaybookReady("reopened same profile");
    const reopenedRow = await reopened.getDay(todayKey);
    assert(reopenedRow?.main.includes("two tab sync"), "A15: same-profile browser reopen must preserve content.");
    evidence.checks.a15Reopen = { todayKey, reopenedRow };
    reopened.close();
    await stopChrome(session);
    session = null;

    rmSync(profile, { force: true, recursive: true });
    await mkdir(profile, { recursive: true });
    session = await launchChrome(executable, profile);
    const imported = await firstDaybookPage();
    await imported.send("Page.enable");
    await imported.send("Runtime.enable");
    await imported.waitForDaybookReady("fresh import profile");
    await imported.putRows(payload);
    await imported.send("Page.reload", { ignoreCache: true });
    await imported.waitForDaybookReady("fresh import reload");
    const importedRow = await imported.getDay(todayKey);
    assert(importedRow?.main.includes("two tab sync"), "A16: fresh-profile browser import must restore content.");
    const importedSettings = (await imported.readStore("meta")).find((row) => row.id === "settings")?.value ?? null;
    const importedDark = await imported.evaluate(`document.documentElement.classList.contains("dark")`);
    assert(importedSettings?.theme === "dark" && importedSettings?.weekStartsOn === 1 && importedDark, "A16: fresh-profile browser import must restore settings.");
    evidence.checks.a16FreshProfileImport = { todayKey, importedRow, importedSettings, importedDark };
    imported.close();
    await stopChrome(session);
    session = null;

    rmSync(midnightProfile, { force: true, recursive: true });
    await mkdir(midnightProfile, { recursive: true });
    session = await launchChrome(executable, midnightProfile, "about:blank");
    const midnight = await firstDaybookPage();
    await midnight.send("Page.enable");
    await midnight.send("Runtime.enable");
    await midnight.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        const RealDate = Date;
        let now = new RealDate("2026-07-03T23:59:30");
        function MockDate(...args) {
          return args.length ? new RealDate(...args) : new RealDate(now);
        }
        MockDate.UTC = RealDate.UTC;
        MockDate.parse = RealDate.parse;
        MockDate.now = () => now.getTime();
        MockDate.prototype = RealDate.prototype;
        window.Date = MockDate;
        window.__setDaybookNow = (value) => { now = new RealDate(value); };
      })();`,
    });
    await midnight.send("Page.navigate", { url: "chrome://newtab/" });
    await midnight.waitForDaybookReady("fake-clock daybook");
    const beforeMidnight = await midnight.evaluate(`document.querySelector(".day-section.today")?.dataset.date`);
    assert(beforeMidnight === "2026-07-03", `A17: fake clock must start on July 3. ${beforeMidnight}`);
    await midnight.evaluate(`window.__setDaybookNow("2026-07-04T00:01:00"); window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange"));`);
    await midnight.waitFor(`document.querySelector(".day-section.today")?.dataset.date === "2026-07-04"`, "A17: midnight today rollover", 5000);
    const afterMidnight = await midnight.json(`{
      today: document.querySelector(".day-section.today")?.dataset.date,
      firstVisible: [...document.querySelectorAll(".day-section")][0]?.dataset.date,
      activeToday: !!document.activeElement?.closest(".day-section.today")
    }`);
    evidence.checks.a17Midnight = { beforeMidnight, afterMidnight };
    midnight.close();

    const allHttpRequests = [
      ...(page1?.httpRequests ?? []),
      ...(page2?.httpRequests ?? []),
      ...(evidence.httpRequests ?? []),
    ];
    evidence.httpRequests = allHttpRequests;
    assert(allHttpRequests.length === 0, `Final browser proof must not make HTTP(S) requests. ${JSON.stringify(allHttpRequests)}`);
    evidence.browser = executable;
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`Daybook final browser verification passed: ${evidencePath}`);
  } finally {
    await stopChrome(session);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
