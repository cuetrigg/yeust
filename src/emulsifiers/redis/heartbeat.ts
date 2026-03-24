export interface RedisHeartbeatMonitorOptions {
  readonly selfId: string;
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly onHeartbeat: (
    type: "heartbeat:init" | "heartbeat",
  ) => Promise<void> | void;
  readonly onNodeRemoved: (
    nodeId: string,
    reason: "timeout" | "close",
  ) => Promise<void> | void;
  readonly onError?: (error: Error) => void;
}

export class RedisHeartbeatMonitor {
  readonly #selfId: string;
  readonly #intervalMs: number;
  readonly #timeoutMs: number;
  readonly #onHeartbeat: RedisHeartbeatMonitorOptions["onHeartbeat"];
  readonly #onNodeRemoved: RedisHeartbeatMonitorOptions["onNodeRemoved"];
  readonly #onError?: (error: Error) => void;
  readonly #nodes = new Map<string, number>();

  #heartbeatTimer?: ReturnType<typeof setInterval>;
  #cleanupTimer?: ReturnType<typeof setInterval>;
  #started = false;

  constructor(options: RedisHeartbeatMonitorOptions) {
    this.#selfId = options.selfId;
    this.#intervalMs = options.intervalMs;
    this.#timeoutMs = options.timeoutMs;
    this.#onHeartbeat = options.onHeartbeat;
    this.#onNodeRemoved = options.onNodeRemoved;
    this.#onError = options.onError;
  }

  seed(nodeIds: Iterable<string>): void {
    const now = Date.now();

    for (const nodeId of nodeIds) {
      if (!nodeId || nodeId === this.#selfId) {
        continue;
      }

      this.#nodes.set(nodeId, now);
    }
  }

  touch(nodeId: string): void {
    if (!nodeId || nodeId === this.#selfId) {
      return;
    }

    this.#nodes.set(nodeId, Date.now());
  }

  getActiveNodeIds(): string[] {
    return [...this.#nodes.keys()];
  }

  async start(): Promise<void> {
    if (this.#started) {
      return;
    }

    this.#started = true;
    await this.#emitHeartbeat("heartbeat:init");
    this.#heartbeatTimer = setInterval(() => {
      void this.#emitHeartbeat("heartbeat");
    }, this.#intervalMs);
    this.#cleanupTimer = setInterval(() => {
      void this.#pruneStaleNodes();
    }, Math.max(50, Math.min(this.#intervalMs, Math.floor(this.#timeoutMs / 2))));
  }

  async stop(): Promise<void> {
    this.#started = false;

    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = undefined;
    }

    if (this.#cleanupTimer) {
      clearInterval(this.#cleanupTimer);
      this.#cleanupTimer = undefined;
    }
  }

  async markClosed(nodeId: string): Promise<void> {
    await this.#removeNode(nodeId, "close");
  }

  async #emitHeartbeat(type: "heartbeat:init" | "heartbeat"): Promise<void> {
    try {
      await this.#onHeartbeat(type);
    } catch (error) {
      this.#onError?.(toError(error));
    }
  }

  async #pruneStaleNodes(): Promise<void> {
    const cutoff = Date.now() - this.#timeoutMs;

    for (const [nodeId, lastSeenAt] of this.#nodes) {
      if (lastSeenAt < cutoff) {
        await this.#removeNode(nodeId, "timeout");
      }
    }
  }

  async #removeNode(
    nodeId: string,
    reason: "timeout" | "close",
  ): Promise<void> {
    if (!this.#nodes.delete(nodeId)) {
      return;
    }

    try {
      await this.#onNodeRemoved(nodeId, reason);
    } catch (error) {
      this.#onError?.(toError(error));
    }
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
