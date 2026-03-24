import type { ServerWebSocket } from "bun";

export type SocketId = string;
export type RecoverySessionId = string;
export type PocketName = string;

export interface SocketContext<TSocketData = unknown, TSessionData = unknown> {
  readonly socketId: SocketId;
  readonly sessionId: RecoverySessionId;
  readonly ws: ServerWebSocket<TSocketData>;
  readonly connectedAt: number;
  data: TSessionData;
  pockets: Set<PocketName>;
  lastOffset?: string;
}

export interface CreateSocketContextOptions<
  TSocketData = unknown,
  TSessionData = unknown,
> {
  readonly socketId: SocketId;
  readonly ws: ServerWebSocket<TSocketData>;
  readonly data?: TSessionData;
  readonly sessionId?: RecoverySessionId;
  readonly pockets?: Iterable<PocketName>;
  readonly connectedAt?: number;
  readonly lastOffset?: string;
}

export function createSocketContext<TSocketData = unknown, TSessionData = unknown>(
  options: CreateSocketContextOptions<TSocketData, TSessionData>,
): SocketContext<TSocketData, TSessionData> {
  return {
    socketId: options.socketId,
    sessionId: options.sessionId ?? crypto.randomUUID(),
    ws: options.ws,
    connectedAt: options.connectedAt ?? Date.now(),
    data: options.data as TSessionData,
    pockets: new Set(options.pockets ?? []),
    lastOffset: options.lastOffset,
  };
}

export function cloneSocketContext<TSocketData = unknown, TSessionData = unknown>(
  context: SocketContext<TSocketData, TSessionData>,
): SocketContext<TSocketData, TSessionData> {
  return {
    ...context,
    pockets: new Set(context.pockets),
  };
}
