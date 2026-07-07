import { db, type PanelRow } from "./db";

// the panel row a scratchpad widget's content lives in. the original core
// scratchpad keeps the classic "scratchpad" row (and root scratchpad.md);
// every other scratchpad widget owns a `widget:<id>` row (mirrored to
// widgets/<id>.md). one function so the dual path is defined in exactly one place.
export function scratchpadPanelId(widgetId: string): string {
  return widgetId === "scratchpad" ? "scratchpad" : `widget:${widgetId}`;
}

// the widget id a `widget:<id>` panel belongs to, or null for classic panels
export function widgetIdFromPanelId(panelId: string): string | null {
  return panelId.startsWith("widget:") ? panelId.slice("widget:".length) : null;
}

export async function getPanel(id: PanelRow["id"]): Promise<PanelRow> {
  const existing = await db.panels.get(id);
  return existing ?? { id, content: "", updatedAt: 0 };
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
