import { RedisClient, type RedisOptions } from "bun";
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
} from "../../protocol/ack.ts";
import {
  withMessageId,
  withRecoveryOffset,
  type OutboundFrame,
} from "../../protocol/frames.ts";
import {
  isReplayableFrame,
  isValidRecoveryOffset,
  nextRecoveryOffset,
  shouldReplayFrame,
  type RecoveredSession,
  type RecoverySession,
} from "../../protocol/recovery.ts";
import type { RecoverySessionId, SocketContext, SocketId } from "../../sockets/context.ts";
import { BaseEmulsifier } from "../base-emulsifier.ts";
import { emulsifierFactory } from "../factory.ts";
import type {
  AckBroadcastOptions,
  BroadcastOptions,
  CreateEmulsifierOptions,
  EmulsifierFactoryContext,
  Pocket,
} from "../types.ts";
import { RedisCoordinator } from "./coordinator.ts";
import { decodeRedisClusterMessage } from "./codec.ts";
import { RedisHeartbeatMonitor } from "./heartbeat.ts";
import {
  type RedisAdapterCloseMessage,
  type RedisBroadcastAckCountMessage,
  type RedisBroadcastAckResponseMessage,
  type RedisBroadcastMessage,
  type RedisClusterMessage,
  serializeBroadcastOptions,
} from "./messages.ts";
import { RedisRecoveryStore } from "./recovery-store.ts";
import { xrange } from "./stream-commands.ts";

const DEFAULT_ACK_TIMEOUT_MS = 5_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 10_000;
const DEFAULT_SESSION_TTL_MS = 120_000;
const DEFAULT_RESTORE_BATCH_SIZE = 100;
const DEFAULT_RESTORE_MAX_BATCHES = 100;

export interface RedisEmulsifierOptions {
  readonly uid?: string;
  readonly redis?: RedisClient;
  readonly commandClient?: RedisClient;
  readonly streamClient?: RedisClient;
  readonly redisUrl?: string;
  readonly redisOptions?: RedisOptions;
  readonly streamName?: string;
  readonly nodesKey?: string;
  readonly sessionKeyPrefix?: string;
  readonly sessionTtlMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatTimeoutMs?: number;
  readonly readCount?: number;
  readonly blockMs?: number;
  readonly maxLen?: number;
  readonly restoreBatchSize?: number;
  readonly restoreMaxBatches?: number;
  readonly onError?: (error: Error) => void;
}

interface RedisClientResources {
  readonly commandClient: RedisClient;
  readonly ownsCommandClient: boolean;
  readonly streamClient: RedisClient;
  readonly ownsStreamClient: boolean;
}

interface DistributedAckRequest {
  readonly tracker: AckTracker;
  readonly pendingNodeIds: Set<string>;
  readonly resolve: (result: AckResult) => void;
}

export class RedisEmulsifier<
  TSocketData = unknown,
  TSessionData = unknown,
> extends BaseEmulsifier<TSocketData, TSessionData> {
  readonly uid: string;
  readonly scope: string;
  readonly streamName: string;
  readonly nodesKey: string;
  readonly sessionKeyPrefix: string;

  readonly #options: RedisEmulsifierOptions;
  readonly #distributedAckRequests = new Map<string, DistributedAckRequest>();

  #closed = false;
  #coordinator?: RedisCoordinator;
  #heartbeat?: RedisHeartbeatMonitor;
  #recoveryStore?: RedisRecoveryStore<TSessionData>;
  #unsubscribe?: () => void;
  #resources?: RedisClientResources;
  #readyPromise?: Promise<void>;

  constructor(
    options: RedisEmulsifierOptions = {},
    context: EmulsifierFactoryContext,
  ) {
    super("redis", {
      clustered: true,
      acknowledgements: true,
      connectionStateRecovery: true,
    });

    this.uid = options.uid ?? crypto.randomUUID();
    this.scope = context.scope;
    this.streamName = options.streamName ?? `yeust:{${context.scope}}:stream`;
    this.nodesKey = options.nodesKey ?? `yeust:{${context.scope}}:nodes`;
    this.sessionKeyPrefix =
      options.sessionKeyPrefix ?? `yeust:{${context.scope}}:session:`;
    this.#options = options;
  }

  override addSocket(context: SocketContext<TSocketData, TSessionData>): void {
    super.addSocket(context);
    void this.#ensureReady().catch(this.#handleError);
  }

  override async join(socketId: SocketId, pockets: Iterable<Pocket>): Promise<void> {
    const pocketList = [...pockets];

    super.join(socketId, pocketList);

    if (this.#closed || pocketList.length === 0) {
      return;
    }

    await this.#publish({
      uid: this.uid,
      scope: this.scope,
      type: "pockets:join",
      socketId,
      pockets: pocketList,
    });
  }

  override async leave(socketId: SocketId, pockets: Iterable<Pocket>): Promise<void> {
    const pocketList = [...pockets];

    super.leave(socketId, pocketList);

    if (this.#closed || pocketList.length === 0) {
      return;
    }

    await this.#publish({
      uid: this.uid,
      scope: this.scope,
      type: "pockets:leave",
      socketId,
      pockets: pocketList,
    });
  }

  override async broadcast(
    frame: OutboundFrame,
    options: BroadcastOptions = {},
  ): Promise<void> {
    if (this.#closed || options.flags?.local) {
      await super.broadcast(frame, options);
      return;
    }

    await this.#ensureReady();

    const message: RedisBroadcastMessage = {
      uid: this.uid,
      scope: this.scope,
      type: "broadcast",
      frame,
      options: serializeBroadcastOptions({
        pockets: options.pockets ? [...options.pockets] : undefined,
        except: options.except ? [...options.except] : undefined,
        socketIds: options.socketIds ? [...options.socketIds] : undefined,
        flags: options.flags,
      }),
    };
    const offset = await this.#coordinator!.publish(message);
    const frameWithOffset = this.#attachRecoveryOffset(frame, options, offset, false);

    await super.broadcast(frameWithOffset, options);
  }

  override async broadcastWithAck(
    frame: OutboundFrame,
    options: AckBroadcastOptions = {},
  ): Promise<AckResult> {
    if (this.#closed || options.flags?.local) {
      return super.broadcastWithAck(frame, options);
    }

    await this.#ensureReady();

    const frameWithId = frame.id ? frame : withMessageId(frame);
    const timeoutMs = options.timeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
    const remoteNodeIds = await this.#getRemoteNodeIds();
    let resolveResult!: (result: AckResult) => void;

    const result = new Promise<AckResult>((resolve) => {
      resolveResult = resolve;
    });

    const tracker = createAckTracker({
      requestId: frameWithId.id!,
      timeoutMs,
    });
    const request: DistributedAckRequest = {
      tracker,
      pendingNodeIds: new Set(remoteNodeIds),
      resolve: resolveResult,
    };
    this.#distributedAckRequests.set(frameWithId.id!, request);
    scheduleAckTimeout(tracker, (ackResult) => {
      void this.#finishDistributedAckRequest(frameWithId.id!, ackResult);
    });

    const localDispatch = this.broadcastLocalWithAck(frameWithId, options, {
      timeoutMs,
      onResponse: (socketId, response) =>
        this.#recordDistributedAckResponse(
          frameWithId.id!,
          `${this.uid}:${socketId}`,
          response,
        ),
      onComplete: () => this.#maybeFinishDistributedAckRequest(frameWithId.id!),
    });
    addExpectedAcks(tracker, localDispatch.expected);

    if (remoteNodeIds.length === 0) {
      await this.#maybeFinishDistributedAckRequest(frameWithId.id!);
      return result;
    }

    await this.#publish({
      uid: this.uid,
      scope: this.scope,
      type: "broadcast",
      frame: frameWithId,
      requestId: frameWithId.id,
      timeoutMs,
      options: serializeBroadcastOptions({
        pockets: options.pockets ? [...options.pockets] : undefined,
        except: options.except ? [...options.except] : undefined,
        socketIds: options.socketIds ? [...options.socketIds] : undefined,
        flags: options.flags,
      }),
    });

    await this.#maybeFinishDistributedAckRequest(frameWithId.id!);
    return result;
  }

  override async persistSession(
    session: RecoverySession<TSessionData>,
  ): Promise<void> {
    await this.#ensureReady();
    await this.#recoveryStore!.persist(session);
  }

  override async restoreSession(
    sessionId: RecoverySessionId,
    offset: string,
  ): Promise<RecoveredSession<TSessionData> | null> {
    await this.#ensureReady();

    if (!isValidRecoveryOffset(offset)) {
      return null;
    }

    const offsetEntry = await xrange(
      this.#resources!.commandClient,
      this.streamName,
      offset,
      offset,
      { count: 1 },
    );

    if (offsetEntry.length === 0) {
      return null;
    }

    const session = await this.#recoveryStore!.consume(sessionId);

    if (!session) {
      return null;
    }

    const missedFrames: OutboundFrame[] = [];
    let currentOffset = offset;
    const restoreBatchSize = this.#options.restoreBatchSize ?? DEFAULT_RESTORE_BATCH_SIZE;
    const restoreMaxBatches = this.#options.restoreMaxBatches ?? DEFAULT_RESTORE_MAX_BATCHES;

    for (let batchIndex = 0; batchIndex < restoreMaxBatches; batchIndex += 1) {
      const entries = await xrange(
        this.#resources!.commandClient,
        this.streamName,
        nextRecoveryOffset(currentOffset),
        "+",
        { count: restoreBatchSize },
      );

      if (entries.length === 0) {
        break;
      }

      for (const entry of entries) {
        currentOffset = entry.id;
        const message = decodeRedisClusterMessage(entry.fields);

        if (message.type !== "broadcast" || message.scope !== this.scope) {
          continue;
        }

        if (
          !isReplayableFrame(message.frame, {
            volatile: message.options?.flags?.volatile,
            requiresAcknowledgement: message.requestId !== undefined,
          })
        ) {
          continue;
        }

        if (!shouldReplayFrame(session.pockets, message.options ?? {})) {
          continue;
        }

        missedFrames.push(withRecoveryOffset(message.frame, entry.id));
      }
    }

    return this.#recoveryStore!.createRecoveredSession(session, missedFrames);
  }

  override async close(): Promise<void> {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    this.#unsubscribe?.();
    this.#distributedAckRequests.forEach((request, requestId) => {
      cancelAckTimeout(request.tracker);
      request.resolve(toAckResult(request.tracker));
      this.#distributedAckRequests.delete(requestId);
    });

    if (this.#heartbeat) {
      await this.#heartbeat.stop();
    }

    if (this.#coordinator) {
      try {
        await this.#coordinator.publish({
          uid: this.uid,
          scope: this.scope,
          type: "adapter:close",
        });
      } catch {
        // Best effort on shutdown.
      }
    }

    if (this.#resources?.commandClient.connected) {
      await this.#resources.commandClient.srem(this.nodesKey, this.uid);
    }

    if (this.#coordinator) {
      await this.#coordinator.close();
    }

    this.sockets.clear();
    this.pockets.clear();

    if (this.#resources?.ownsStreamClient) {
      this.#resources.streamClient.close();
    }

    if (this.#resources?.ownsCommandClient) {
      this.#resources.commandClient.close();
    }
  }

  async #ensureReady(): Promise<void> {
    if (this.#closed) {
      throw new Error("Redis emulsifier is closed.");
    }

    this.#readyPromise ??= this.#initialize();
    await this.#readyPromise;
  }

  async #initialize(): Promise<void> {
    this.#resources = await this.#createResources();
    this.#recoveryStore = new RedisRecoveryStore<TSessionData>({
      client: this.#resources.commandClient,
      sessionKeyPrefix: this.sessionKeyPrefix,
      sessionTtlMs: this.#options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS,
    });
    await this.#resources.commandClient.sadd(this.nodesKey, this.uid);
    const seedNodeIds = await this.#resources.commandClient.smembers(this.nodesKey);
    this.#coordinator = new RedisCoordinator({
      commandClient: this.#resources.commandClient,
      streamClient: this.#resources.streamClient,
      streamName: this.streamName,
      readCount: this.#options.readCount,
      blockMs: this.#options.blockMs,
      maxLen: this.#options.maxLen,
      onError: this.#options.onError,
    });
    this.#unsubscribe = this.#coordinator.addListener(
      this.scope,
      (message, streamId) => this.#handleClusterMessage(message, streamId),
    );
    await this.#coordinator.start();
    this.#heartbeat = new RedisHeartbeatMonitor({
      selfId: this.uid,
      intervalMs:
        this.#options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
      timeoutMs:
        this.#options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS,
      onHeartbeat: async (type) => {
        await this.#coordinator!.publish({
          uid: this.uid,
          scope: this.scope,
          type,
        });
      },
      onNodeRemoved: (nodeId) => this.#handleNodeRemoved(nodeId),
      onError: this.#options.onError,
    });
    this.#heartbeat.seed(seedNodeIds);
    await this.#heartbeat.start();
  }

  async #createResources(): Promise<RedisClientResources> {
    const commandClient =
      this.#options.commandClient ??
      this.#options.redis ??
      new RedisClient(this.#options.redisUrl, this.#options.redisOptions);
    const ownsCommandClient =
      this.#options.commandClient === undefined && this.#options.redis === undefined;

    if (!commandClient.connected) {
      await commandClient.connect();
    }

    const streamClient =
      this.#options.streamClient ?? (await commandClient.duplicate());
    const ownsStreamClient = this.#options.streamClient === undefined;

    if (!streamClient.connected) {
      await streamClient.connect();
    }

    return {
      commandClient,
      ownsCommandClient,
      streamClient,
      ownsStreamClient,
    };
  }

  async #publish(message: RedisClusterMessage): Promise<string> {
    await this.#ensureReady();
    return this.#coordinator!.publish(message);
  }

  async #handleClusterMessage(
    message: RedisClusterMessage,
    streamId: string,
  ): Promise<void> {
    if (message.uid === this.uid) {
      return;
    }

    this.#heartbeat?.touch(message.uid);

    switch (message.type) {
      case "heartbeat:init":
      case "heartbeat":
        break;
      case "adapter:close":
        await this.#handleAdapterClose(message);
        break;
      case "broadcast":
        if (message.requestId) {
          await this.#handleRemoteAckBroadcast(message);
          return;
        }

        await super.broadcast(
          this.#attachRecoveryOffset(
            message.frame,
            message.options ?? {},
            streamId,
            false,
          ),
          message.options ?? {},
        );
        break;
      case "broadcast:ack:count":
        if (message.targetUid !== this.uid) {
          return;
        }

        await this.#recordDistributedAckCount(message);
        break;
      case "broadcast:ack:response":
        if (message.targetUid !== this.uid) {
          return;
        }

        await this.#recordDistributedAckResponse(
          message.requestId,
          `${message.uid}:${message.socketId}`,
          message.response,
        );
        break;
      case "pockets:join":
        super.join(message.socketId, message.pockets);
        break;
      case "pockets:leave":
        super.leave(message.socketId, message.pockets);
        break;
    }
  }

  async #handleRemoteAckBroadcast(message: RedisBroadcastMessage): Promise<void> {
    const dispatch = this.broadcastLocalWithAck(message.frame, message.options ?? {}, {
      timeoutMs: message.timeoutMs ?? DEFAULT_ACK_TIMEOUT_MS,
      onResponse: async (socketId, response) => {
        await this.#publish({
          uid: this.uid,
          scope: this.scope,
          type: "broadcast:ack:response",
          requestId: message.requestId!,
          targetUid: message.uid,
          socketId,
          response,
        });
      },
    });

    const countMessage: RedisBroadcastAckCountMessage = {
      uid: this.uid,
      scope: this.scope,
      type: "broadcast:ack:count",
      requestId: message.requestId!,
      targetUid: message.uid,
      count: dispatch.expected,
    };
    await this.#publish(countMessage);
  }

  async #recordDistributedAckCount(
    message: RedisBroadcastAckCountMessage,
  ): Promise<void> {
    const request = this.#distributedAckRequests.get(message.requestId);

    if (!request) {
      return;
    }

    request.pendingNodeIds.delete(message.uid);
    addExpectedAcks(request.tracker, message.count);
    await this.#maybeFinishDistributedAckRequest(message.requestId);
  }

  async #recordDistributedAckResponse(
    requestId: string,
    sourceId: string,
    response: unknown,
  ): Promise<void> {
    const request = this.#distributedAckRequests.get(requestId);

    if (!request) {
      return;
    }

    const added = recordAckResponse(request.tracker, sourceId, response);

    if (!added) {
      return;
    }

    await this.#maybeFinishDistributedAckRequest(requestId);
  }

  async #maybeFinishDistributedAckRequest(requestId: string): Promise<void> {
    const request = this.#distributedAckRequests.get(requestId);

    if (!request) {
      return;
    }

    if (request.pendingNodeIds.size > 0) {
      return;
    }

    if (!isAckComplete(request.tracker)) {
      return;
    }

    await this.#finishDistributedAckRequest(requestId);
  }

  async #finishDistributedAckRequest(
    requestId: string,
    presetResult?: AckResult,
  ): Promise<void> {
    const request = this.#distributedAckRequests.get(requestId);

    if (!request) {
      return;
    }

    this.#distributedAckRequests.delete(requestId);
    cancelAckTimeout(request.tracker);
    request.resolve(presetResult ?? toAckResult(request.tracker));
  }

  async #getRemoteNodeIds(): Promise<string[]> {
    return this.#heartbeat?.getActiveNodeIds() ?? [];
  }

  async #handleAdapterClose(_message: RedisAdapterCloseMessage): Promise<void> {
    await this.#heartbeat?.markClosed(_message.uid);
  }

  async #handleNodeRemoved(nodeId: string): Promise<void> {
    if (this.#resources?.commandClient.connected) {
      await this.#resources.commandClient.srem(this.nodesKey, nodeId);
    }

    for (const [requestId, request] of this.#distributedAckRequests) {
      request.pendingNodeIds.delete(nodeId);
      await this.#maybeFinishDistributedAckRequest(requestId);
    }
  }

  #attachRecoveryOffset(
    frame: OutboundFrame,
    options: BroadcastOptions,
    offset: string,
    requiresAcknowledgement: boolean,
  ): OutboundFrame {
    if (
      !isReplayableFrame(frame, {
        volatile: options.flags?.volatile,
        requiresAcknowledgement,
      })
    ) {
      return frame;
    }

    return withRecoveryOffset(frame, offset);
  }

  #handleError = (error: unknown): void => {
    this.#options.onError?.(error instanceof Error ? error : new Error(String(error)));
  };
}

export function createRedisEmulsifier(
  options: RedisEmulsifierOptions = {},
  context: EmulsifierFactoryContext,
): RedisEmulsifier {
  return new RedisEmulsifier(options, context);
}

emulsifierFactory.register("redis", (options, context) =>
  createRedisEmulsifier(
    (options as RedisEmulsifierOptions | undefined) ?? {},
    context,
  ),
);

export type RedisEmulsifierDefinition = CreateEmulsifierOptions<RedisEmulsifierOptions>;
