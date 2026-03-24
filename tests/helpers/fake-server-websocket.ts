import type { ServerWebSocket } from "bun";

export interface SentWebSocketMessage {
  readonly data: string | ArrayBuffer | ArrayBufferView;
  readonly compress?: boolean;
}

export interface FakeServerWebSocket<T = unknown> {
  readonly ws: ServerWebSocket<T>;
  readonly sent: SentWebSocketMessage[];
}

export function createFakeServerWebSocket<T = unknown>(
  data: T,
): FakeServerWebSocket<T> {
  const sent: SentWebSocketMessage[] = [];

  const ws = {
    data,
    readyState: WebSocket.OPEN,
    send(message: string | ArrayBuffer | ArrayBufferView, compress?: boolean) {
      sent.push({ data: message, compress });

      if (typeof message === "string") {
        return message.length;
      }

      return message.byteLength;
    },
    getBufferedAmount() {
      return 0;
    },
  } as unknown as ServerWebSocket<T>;

  return { ws, sent };
}
