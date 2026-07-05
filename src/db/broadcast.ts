export type DaybookChange =
  | { type: "day"; key: string; updatedAt: number }
  | { type: "panel"; key: "scratchpad" | "masterList"; updatedAt: number }
  | { type: "settings"; key: "settings"; updatedAt: number }
  | { type: "import"; key: "all"; updatedAt: number };

export interface DaybookChannel {
  post: (message: DaybookChange) => void;
  listen: (handler: (message: DaybookChange) => void) => () => void;
  close: () => void;
}

export const channelName = "daybook";

export function createDaybookChannel(): DaybookChannel {
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
      const listener = (event: MessageEvent<DaybookChange>) => handler(event.data);
      channel.addEventListener("message", listener);
      return () => channel.removeEventListener("message", listener);
    },
    close: () => channel.close(),
  };
}
