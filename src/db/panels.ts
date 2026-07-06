import { db, type PanelRow } from "./db";

export async function getPanel(id: PanelRow["id"]): Promise<PanelRow> {
  const existing = await db.panels.get(id);
  return existing ?? { id, content: "", updatedAt: 0 };
}

export async function appendToPanel(id: PanelRow["id"], text: string): Promise<PanelRow> {
  return db.transaction("rw", db.panels, async () => {
    const existing = await getPanel(id);
    const joined = existing.content.trim() ? `${existing.content.replace(/\n+$/, "")}\n${text.trim()}` : text.trim();
    return savePanel(id, joined);
  });
}

export async function savePanel(id: PanelRow["id"], content: string): Promise<PanelRow> {
  const row: PanelRow = {
    id,
    content,
    updatedAt: Date.now(),
  };
  await db.panels.put(row);
  return row;
}
