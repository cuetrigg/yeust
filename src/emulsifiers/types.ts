import type { AckResult } from "../protocol/ack.ts";
import type { InboundFrame, OutboundFrame } from "../protocol/frames.ts";
import type {
  RecoveredSession,
  RecoverySession,
} from "../protocol/recovery.ts";
import type {
  PocketName,
  RecoverySessionId,
  SocketContext,
  SocketId,
} from "../sockets/context.ts";

export type Pocket = PocketName;
export type SessionId = RecoverySessionId;
export type EmulsifierType = "memory" | "redis" | (string & {});

export interface BroadcastFlags {
  readonly binary?: boolean;
  readonly compress?: boolean;
  readonly local?: boolean;
  readonly volatile?: boolean;
}

export interface BroadcastOptions {
  readonly pockets?: Iterable<Pocket>;
  readonly except?: Iterable<Pocket>;
  readonly socketIds?: Iterable<SocketId>;
  readonly flags?: BroadcastFlags;
}

export interface AckBroadcastOptions extends BroadcastOptions {
  readonly timeoutMs?: number;
}

export interface EmulsifierCapabilities {
  readonly clustered: boolean;
  readonly acknowledgements: boolean;
  readonly connectionStateRecovery: boolean;
}

export interface EmulsifierEventMap {
  readonly create: { pocket: Pocket };
  readonly delete: { pocket: Pocket };
  readonly join: { pocket: Pocket; socketId: SocketId };
  readonly leave: { pocket: Pocket; socketId: SocketId };
}

export type EmulsifierEventName = keyof EmulsifierEventMap;
export type EmulsifierEventListener<TEvent extends EmulsifierEventName> = (
  event: EmulsifierEventMap[TEvent],
) => void;

export interface Emulsifier<TSocketData = unknown, TSessionData = unknown> {
  readonly type: EmulsifierType;
  readonly capabilities: EmulsifierCapabilities;
  readonly size: number;
  addSocket(context: SocketContext<TSocketData, TSessionData>): void;
  removeSocket(socketId: SocketId): Promise<void> | void;
  hasSocket(socketId: SocketId): boolean;
  join(socketId: SocketId, pockets: Iterable<Pocket>): Promise<void> | void;
  leave(socketId: SocketId, pockets: Iterable<Pocket>): Promise<void> | void;
  broadcast(frame: OutboundFrame, options?: BroadcastOptions): Promise<void> | void;
  broadcastWithAck(
    frame: OutboundFrame,
    options?: AckBroadcastOptions,
  ): Promise<AckResult>;
  persistSession(session: RecoverySession<TSessionData>): Promise<void> | void;
  restoreSession(
    sessionId: RecoverySessionId,
    offset: string,
  ): Promise<RecoveredSession<TSessionData> | null>;
  handleInboundFrame(
    socketId: SocketId,
    frame: InboundFrame,
  ): Promise<boolean> | boolean;
  on<TEvent extends EmulsifierEventName>(
    event: TEvent,
    listener: EmulsifierEventListener<TEvent>,
  ): () => void;
  off<TEvent extends EmulsifierEventName>(
    event: TEvent,
    listener: EmulsifierEventListener<TEvent>,
  ): void;
  close(): Promise<void> | void;
}

export interface EmulsifierFactoryContext {
  readonly scope: string;
}

export interface CreateEmulsifierOptions<TOptions = unknown> {
  readonly type: EmulsifierType;
  readonly options?: TOptions;
}

export type EmulsifierCreator<TOptions = unknown> = (
  options: TOptions | undefined,
  context: EmulsifierFactoryContext,
) => Emulsifier;
