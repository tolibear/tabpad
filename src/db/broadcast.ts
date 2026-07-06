export type TabPadChange =
  | { type: "day"; key: string; updatedAt: number }
  | { type: "panel"; key: "scratchpad" | "masterList"; updatedAt: number }
  | { type: "settings"; key: "settings"; updatedAt: number }
  | { type: "import"; key: "all"; updatedAt: number }
  // sent BEFORE an erase starts so other tabs cancel pending writes that
  // would resurrect the erased notes
  | { type: "erase"; key: "all"; updatedAt: number };

export interface TabPadChannel {
  post: (message: TabPadChange) => void;
  listen: (handler: (message: TabPadChange) => void) => () => void;
  close: () => void;
}

export const channelName = "tabpad";

export function createTabPadChannel(): TabPadChannel {
  if (!("BroadcastChannel" in globalThis)) {
    return {
      post: () => undefined,
      listen: () => () => undefined,
      close: () => undefined,
    };
  }

  const channel = new BroadcastChannel(channelName);

  return {
    post: (message) => channel.postMessage(message),
    listen: (handler) => {
      const listener = (event: MessageEvent<TabPadChange>) => handler(event.data);
      channel.addEventListener("message", listener);
      return () => channel.removeEventListener("message", listener);
    },
    close: () => channel.close(),
  };
}
