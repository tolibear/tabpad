import { db, defaultSettings, type Settings } from "./db";

const SETTINGS_ID = "settings";

export async function getSettings(): Promise<Settings> {
  const row = await db.meta.get(SETTINGS_ID);
  const settings = { ...defaultSettings, ...(isSettingsPartial(row?.value) ? row.value : {}) };
  // the master list panel was removed; map the legacy stored value to scratchpad
  if ((settings.rightPanel as string) === "masterList") {
    settings.rightPanel = "scratchpad";
  }
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
