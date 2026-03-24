import {
  addExpectedAcks,
  cancelAckTimeout,
  createAckTracker,
  isAckComplete,
  recordAckResponse,
  scheduleAckTimeout,
  toAckResult,
  type AckResult,
  type AckTracker,
} from "../protocol/ack.ts";
import {
  serializeFrame,
  withMessageId,
  type InboundFrame,
  type OutboundFrame,
} from "../protocol/frames.ts";
import type {
  RecoveredSession,
  RecoverySession,
} from "../protocol/recovery.ts";
import { PocketIndex, type PocketIndexChange } from "../pockets/pocket-index.ts";
import { selectSocketIds } from "../pockets/selectors.ts";
import {
  cloneSocketContext,
  type RecoverySessionId,
  type SocketContext,
  type SocketId,
} from "../sockets/context.ts";
import { SocketRegistry } from "../sockets/registry.ts";
import type {
  AckBroadcastOptions,
  BroadcastOptions,
  Emulsifier,
  EmulsifierCapabilities,
  EmulsifierEventListener,
  EmulsifierEventMap,
  EmulsifierEventName,
  EmulsifierType,
  Pocket,
} from "./types.ts";

interface LocalAckRequest {
  readonly tracker: AckTracker;
  readonly expectedSocketIds: Set<SocketId>;
  readonly resolve: (result: AckResult) => void;
  readonly onResponse?: (socketId: SocketId, response: unknown) => void | Promise<void>;
  readonly onComplete?: (result: AckResult) => void | Promise<void>;
}

interface BroadcastLocalWithAckOptions {
  readonly timeoutMs?: number;
  readonly onResponse?: (socketId: SocketId, response: unknown) => void | Promise<void>;
  readonly onComplete?: (result: AckResult) => void | Promise<void>;
}

interface LocalAckDispatch<TFrame extends OutboundFrame = OutboundFrame> {
  readonly requestId: string;
  readonly expected: number;
  readonly frame: TFrame;
  readonly result: Promise<AckResult>;
}

type ListenerSetMap = {
  [TEvent in EmulsifierEventName]: Set<EmulsifierEventListener<TEvent>>;
};

export abstract class BaseEmulsifier<TSocketData = unknown, TSessionData = unknown>
  implements Emulsifier<TSocketData, TSessionData>
{
  readonly #listeners: ListenerSetMap = {
    create: new Set(),
    delete: new Set(),
    join: new Set(),
    leave: new Set(),
  };
  readonly #localAckRequests = new Map<string, LocalAckRequest>();

  readonly sockets = new SocketRegistry<TSocketData, TSessionData>();
  readonly pockets = new PocketIndex();

  readonly type: EmulsifierType;
  readonly capabilities: EmulsifierCapabilities;

  protected constructor(
    type: EmulsifierType,
    capabilities: Partial<EmulsifierCapabilities> = {},
  ) {
    this.type = type;
    this.capabilities = {
      clustered: capabilities.clustered ?? false,
      acknowledgements: capabilities.acknowledgements ?? false,
      connectionStateRecovery: capabilities.connectionStateRecovery ?? false,
    };
  }

  get size(): number {
    return this.sockets.size;
  }

  addSocket(context: SocketContext<TSocketData, TSessionData>): void {
    if (this.hasSocket(context.socketId)) {
      this.removeSocket(context.socketId);
    }

    const storedContext = cloneSocketContext(context);
    const initialPockets = Array.from(storedContext.pockets);
    storedContext.pockets.clear();

    this.sockets.register(storedContext);

    if (initialPockets.length > 0) {
      this.join(storedContext.socketId, initialPockets);
    }
  }

  async removeSocket(socketId: SocketId): Promise<void> {
    const context = this.sockets.get(socketId);

    if (!context) {
      return;
    }

    if (this.capabilities.connectionStateRecovery) {
      await this.persistSession(this.createRecoverySession(context));
    }

    this.sockets.remove(socketId);

    const changes = this.pockets.removeSocket(socketId);
    context.pockets.clear();
    this.emitPocketChanges(changes);
  }

  hasSocket(socketId: SocketId): boolean {
    return this.sockets.has(socketId);
  }

  join(socketId: SocketId, pockets: Iterable<Pocket>): void {
    const context = this.sockets.get(socketId);

    if (!context) {
      return;
    }

    const changes = this.pockets.join(socketId, pockets);
    this.syncContextPockets(context);
    this.emitPocketChanges(changes);
  }

  leave(socketId: SocketId, pockets: Iterable<Pocket>): void {
    const context = this.sockets.get(socketId);

    if (!context) {
      return;
    }

    const changes = this.pockets.leave(socketId, pockets);
    this.syncContextPockets(context);
    this.emitPocketChanges(changes);
  }

  async broadcast(
    frame: OutboundFrame,
    options: BroadcastOptions = {},
  ): Promise<void> {
    for (const context of this.getTargetSockets(options)) {
      this.sendFrame(context, frame, options);
    }
  }

  async broadcastWithAck(
    frame: OutboundFrame,
    options: AckBroadcastOptions = {},
  ): Promise<AckResult> {
    const dispatch = this.broadcastLocalWithAck(frame, options, {
      timeoutMs: options.timeoutMs,
    });

    return dispatch.result;
  }

  async handleInboundFrame(
    socketId: SocketId,
    frame: InboundFrame,
  ): Promise<boolean> {
    if (frame.kind !== "ack") {
      return false;
    }

    const request = this.#localAckRequests.get(frame.replyTo);

    if (!request || !request.expectedSocketIds.has(socketId)) {
      return false;
    }

    if (!recordAckResponse(request.tracker, socketId, frame.data)) {
      return false;
    }

    await request.onResponse?.(socketId, frame.data);

    if (isAckComplete(request.tracker)) {
      await this.finishLocalAckRequest(frame.replyTo);
    }

    return true;
  }

  on<TEvent extends EmulsifierEventName>(
    event: TEvent,
    listener: EmulsifierEventListener<TEvent>,
  ): () => void {
    const listeners = this.#listeners[event] as Set<
      EmulsifierEventListener<TEvent>
    >;
    listeners.add(listener);

    return () => {
      this.off(event, listener);
    };
  }

  off<TEvent extends EmulsifierEventName>(
    event: TEvent,
    listener: EmulsifierEventListener<TEvent>,
  ): void {
    const listeners = this.#listeners[event] as Set<
      EmulsifierEventListener<TEvent>
    >;
    listeners.delete(listener);
  }

  protected getTargetSockets(
    options: BroadcastOptions = {},
  ): SocketContext<TSocketData, TSessionData>[] {
    const socketIds = selectSocketIds(this.pockets, options);
    const targets: SocketContext<TSocketData, TSessionData>[] = [];

    for (const socketId of socketIds) {
      const context = this.sockets.get(socketId);

      if (context) {
        targets.push(context);
      }
    }

    return targets;
  }

  protected sendFrame(
    context: SocketContext<TSocketData, TSessionData>,
    frame: OutboundFrame,
    options: BroadcastOptions = {},
  ): number {
    return context.ws.send(serializeFrame(frame), options.flags?.compress);
  }

  protected broadcastLocalWithAck<TFrame extends OutboundFrame>(
    frame: TFrame,
    options: BroadcastOptions = {},
    localOptions: BroadcastLocalWithAckOptions = {},
  ): LocalAckDispatch<TFrame> {
    const frameWithId = frame.id ? frame : withMessageId(frame);
    let resolveResult!: (result: AckResult) => void;

    const result = new Promise<AckResult>((resolve) => {
      resolveResult = resolve;
    });

    const tracker = createAckTracker({
      requestId: frameWithId.id!,
      timeoutMs: localOptions.timeoutMs,
    });
    const request: LocalAckRequest = {
      tracker,
      expectedSocketIds: new Set(),
      resolve: resolveResult,
      onResponse: localOptions.onResponse,
      onComplete: localOptions.onComplete,
    };
    this.#localAckRequests.set(frameWithId.id!, request);

    for (const context of this.getTargetSockets(options)) {
      const sendStatus = this.sendFrame(context, frameWithId, options);

      if (sendStatus === 0) {
        continue;
      }

      request.expectedSocketIds.add(context.socketId);
      addExpectedAcks(tracker, 1);
    }

    if (tracker.expected === 0) {
      void this.finishLocalAckRequest(frameWithId.id!);
    } else {
      scheduleAckTimeout(tracker, (ackResult) => {
        void this.finishLocalAckRequest(frameWithId.id!, ackResult);
      });
    }

    return {
      requestId: frameWithId.id!,
      expected: tracker.expected,
      frame: frameWithId,
      result,
    };
  }

  protected createRecoverySession(
    context: SocketContext<TSocketData, TSessionData>,
  ): RecoverySession<TSessionData> {
    return {
      sessionId: context.sessionId,
      socketId: context.socketId,
      pockets: [...context.pockets],
      data: context.data,
      disconnectedAt: Date.now(),
    };
  }

  protected async finishLocalAckRequest(
    requestId: string,
    presetResult?: AckResult,
  ): Promise<AckResult | undefined> {
    const request = this.#localAckRequests.get(requestId);

    if (!request) {
      return undefined;
    }

    this.#localAckRequests.delete(requestId);
    cancelAckTimeout(request.tracker);

    const result = presetResult ?? toAckResult(request.tracker);
    request.resolve(result);
    await request.onComplete?.(result);
    return result;
  }

  protected emit<TEvent extends EmulsifierEventName>(
    event: TEvent,
    payload: EmulsifierEventMap[TEvent],
  ): void {
    const listeners = this.#listeners[event] as Set<
      EmulsifierEventListener<TEvent>
    >;

    for (const listener of listeners) {
      listener(payload);
    }
  }

  protected emitPocketChanges(changes: PocketIndexChange[]): void {
    for (const change of changes) {
      switch (change.type) {
        case "create":
          this.emit("create", { pocket: change.pocket });
          break;
        case "delete":
          this.emit("delete", { pocket: change.pocket });
          break;
        case "join":
          if (change.socketId) {
            this.emit("join", {
              pocket: change.pocket,
              socketId: change.socketId,
            });
          }
          break;
        case "leave":
          if (change.socketId) {
            this.emit("leave", {
              pocket: change.pocket,
              socketId: change.socketId,
            });
          }
          break;
      }
    }
  }

  protected syncContextPockets(
    context: SocketContext<TSocketData, TSessionData>,
  ): void {
    context.pockets.clear();

    for (const pocket of this.pockets.getPockets(context.socketId)) {
      context.pockets.add(pocket);
    }
  }

  abstract persistSession(
    session: RecoverySession<TSessionData>,
  ): Promise<void> | void;

  abstract restoreSession(
    sessionId: RecoverySessionId,
    offset: string,
  ): Promise<RecoveredSession<TSessionData> | null>;

  abstract close(): Promise<void> | void;
}
