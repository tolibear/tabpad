import { db, defaultSettings, type Settings } from "./db";

const SETTINGS_ID = "settings";

export async function getSettings(): Promise<Settings> {
  const row = await db.meta.get(SETTINGS_ID);
  const stored = isSettingsPartial(row?.value) ? row.value : {};
  const settings = { ...defaultSettings, ...stored };

  // migrate the legacy single-choice rightPanel setting to the two toggles
  const legacy = (stored as Record<string, unknown>).rightPanel;
  if (typeof legacy === "string" && typeof (stored as Record<string, unknown>).scratchpad !== "boolean") {
    settings.scratchpad = legacy !== "hidden" && legacy !== "margin";
    settings.margins = legacy === "margin";
  }
  settings.scratchpad = settings.scratchpad !== false;
  settings.margins = settings.margins === true;
  return settings;
}

// serialize saves so two rapid changes can't read-modify-write over each other
let saveChain: Promise<unknown> = Promise.resolve();

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const run = async () => {
    const next = { ...(await getSettings()), ...patch };
    await db.meta.put({ id: SETTINGS_ID, value: next });
    return next;
  };
  const result = saveChain.then(run, run);
  saveChain = result.catch(() => undefined);
  return result;
}

function isSettingsPartial(value: unknown): value is Partial<Settings> {
  return typeof value === "object" && value !== null;
}
