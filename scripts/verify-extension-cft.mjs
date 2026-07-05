import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(".");
const dist = resolve("dist");
const profile = "/tmp/daybook-extension-cft-verify";
const screenshotPath = "/tmp/daybook-extension-cft.png";
const evidencePath = "/tmp/daybook-extension-cft-evidence.json";
const port = 9231;

const candidates = [
  "/Users/tonym/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Users/tonym/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function sendFactory(ws) {
  let nextId = 1;
  const pending = new Map();

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
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

async function fetchTargets() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
    } catch {
      await wait(250);
    }
  }
  throw new Error("Chrome for Testing DevTools endpoint did not open.");
}

async function main() {
  const executable = candidates.find((candidate) => existsSync(candidate));
  assert(executable, "Chrome for Testing is required for unpacked-extension verification.");
  assert(existsSync(resolve(dist, "manifest.json")), "dist/manifest.json is missing; run npm run build first.");

  rmSync(profile, { force: true, recursive: true });
  await mkdir(profile, { recursive: true });

  const chrome = spawn(executable, [
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--use-mock-keychain",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    "--window-size=1440,1000",
    "chrome://newtab/",
  ], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  chrome.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    const targets = await fetchTargets();
    const page = targets.find((target) => target.type === "page" && target.title === "Daybook")
      ?? targets.find((target) => target.type === "page" && target.url === "chrome://newtab/")
      ?? targets.find((target) => target.type === "page");
    assert(page?.webSocketDebuggerUrl, "No page target was available from Chrome for Testing.");

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    const httpRequests = [];
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.method !== "Network.requestWillBeSent") return;
      const url = message.params.request.url;
      if (url.startsWith("http://") || url.startsWith("https://")) {
        httpRequests.push(url);
      }
    });

    await new Promise((resolveOpen, reject) => {
      ws.addEventListener("open", resolveOpen, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });

    const send = sendFactory(ws);
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.enable");
    await send("Page.reload", { ignoreCache: true });
    await wait(1300);

    const evaluated = await send("Runtime.evaluate", {
      expression: `(() => {
        const today = new Date();
        const key = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");
        const timeline = document.querySelector(".timeline");
        const timelineRect = timeline?.getBoundingClientRect();
        const sections = [...document.querySelectorAll(".day-section")].map((node) => {
          const rect = node.getBoundingClientRect();
          return { date: node.dataset.date, today: node.classList.contains("today"), top: rect.top, bottom: rect.bottom };
        });
        const firstVisible = sections
          .filter((section) => !timelineRect || section.bottom > timelineRect.top + 24)
          .sort((a, b) => Math.abs(a.top - ((timelineRect?.top ?? 0) + 24)) - Math.abs(b.top - ((timelineRect?.top ?? 0) + 24)))[0];
        return JSON.stringify({
          href: location.href,
          title: document.title,
          body: document.body.innerText.slice(0, 240),
          manifest: chrome.runtime.getManifest(),
          todayKey: key,
          todayDate: document.querySelector(".day-section.today")?.dataset.date ?? "",
          firstVisibleDate: firstVisible?.date ?? "",
          activeMatchesTodayEditor: !!document.activeElement?.closest(".day-section.today"),
          activeClass: document.activeElement?.className || document.activeElement?.tagName,
          sectionCount: sections.length,
        });
      })()`,
      returnByValue: true,
    });
    const pageEvidence = JSON.parse(evaluated.result.result.value);

    await send("Input.insertText", { text: "x" });
    await wait(150);
    const keystroke = await send("Runtime.evaluate", {
      expression: `(() => JSON.stringify({
        todayText: document.querySelector(".day-section.today .cm-content")?.innerText ?? "",
        activeMatchesTodayEditor: !!document.activeElement?.closest(".day-section.today")
      }))()`,
      returnByValue: true,
    });
    const keystrokeEvidence = JSON.parse(keystroke.result.result.value);

    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(screenshotPath, Buffer.from(screenshot.result.data, "base64"));

    const evidence = {
      browser: executable,
      page: pageEvidence,
      keystroke: keystrokeEvidence,
      httpRequests,
      screenshot: screenshotPath,
      targetSummary: targets.map(({ type, url, title }) => ({ type, url, title })),
    };
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

    assert(pageEvidence.href.startsWith("chrome-extension://"), "new tab must load the extension page.");
    assert(pageEvidence.title === "Daybook", "new tab title must be Daybook.");
    assert(pageEvidence.manifest.name === "Daybook", "runtime manifest must be Daybook.");
    assert(Array.isArray(pageEvidence.manifest.permissions) && pageEvidence.manifest.permissions.length === 0, "runtime manifest must have zero permissions.");
    assert(!("background" in pageEvidence.manifest), "runtime manifest must not define a background worker.");
    assert(!("content_scripts" in pageEvidence.manifest), "runtime manifest must not define content scripts.");
    assert(httpRequests.length === 0, "extension page reload must make zero HTTP(S) requests.");
    assert(pageEvidence.todayDate === pageEvidence.todayKey, "today section must use the local date key.");
    assert(pageEvidence.firstVisibleDate === pageEvidence.todayKey, "today must be the first visible timeline day on new tab load.");
    assert(pageEvidence.activeMatchesTodayEditor, "today's editor must be focused on new tab load.");
    assert(keystrokeEvidence.activeMatchesTodayEditor && keystrokeEvidence.todayText.includes("x"), "first keystroke must land in today's editor without a click.");

    await send("Browser.close");
    console.log(`Chrome for Testing extension verification passed: ${evidencePath}`);
  } finally {
    await wait(500);
    if (chrome.exitCode === null) chrome.kill("SIGTERM");
    await wait(500);
    if (chrome.exitCode === null) chrome.kill("SIGKILL");
    if (stderr.includes("--load-extension is not allowed")) {
      throw new Error("Chrome for Testing rejected --load-extension.");
    }
  }
}

await main();
