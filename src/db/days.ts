import { db, type DayRow } from "./db";

export function hasDayContent(main = "", margin = ""): boolean {
  return main.trim() !== "" || margin.trim() !== "";
}

export async function getDay(date: string): Promise<DayRow | undefined> {
  return db.days.get(date);
}

export async function saveDayContent(date: string, main: string, margin?: string): Promise<DayRow | null> {
  return saveDayFields(date, { main, ...(margin === undefined ? {} : { margin }) });
}

// atomic read-modify-write: only the provided fields change, so a save from
// one editor (or tab) can't clobber the other field's newer content
export async function saveDayFields(date: string, patch: { main?: string; margin?: string }): Promise<DayRow | null> {
  return db.transaction("rw", db.days, async () => {
    const existing = await db.days.get(date);
    const main = patch.main ?? existing?.main ?? "";
    const margin = patch.margin ?? existing?.margin ?? "";

    if (!existing && !hasDayContent(main, margin)) {
      return null;
    }

    const now = Date.now();
    const row: DayRow = {
      date,
      main,
      margin,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await db.days.put(row);
    return row;
  });
}

export async function saveDayMargin(date: string, margin: string): Promise<DayRow | null> {
  const existing = await db.days.get(date);
  return saveDayContent(date, existing?.main ?? "", margin);
}

export async function listContentDays(beforeDate?: string, limit = Number.POSITIVE_INFINITY): Promise<DayRow[]> {
  const rows = await db.days.orderBy("date").reverse().toArray();
  return rows
    .filter((row) => (!beforeDate || row.date < beforeDate) && hasDayContent(row.main, row.margin))
    .slice(0, limit);
}

export async function eraseAllNotes(): Promise<void> {
  await db.transaction("rw", db.days, db.panels, async () => {
    await db.days.clear();
    await db.panels.clear();
  });
}

export function firstLineExcerpt(source: string, maxLength = 40): string {
  const first = source
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").replace(/^-\s+/, "").replace(/^- \[[ xX]\]\s+/, "").trim())
    .find(Boolean);

  if (!first) return "";
  return first.length > maxLength ? `${first.slice(0, maxLength - 1)}...` : first;
}
