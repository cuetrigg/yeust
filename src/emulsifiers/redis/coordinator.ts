import type { RedisClient } from "bun";
import { decodeRedisClusterMessage, encodeRedisClusterMessage } from "./codec.ts";
import type { RedisClusterMessage } from "./messages.ts";
import { xadd, xread } from "./stream-commands.ts";

export interface RedisCoordinatorOptions {
  readonly commandClient: RedisClient;
  readonly streamClient: RedisClient;
  readonly streamName: string;
  readonly readCount?: number;
  readonly blockMs?: number;
  readonly maxLen?: number;
  readonly onError?: (error: Error) => void;
}

export type RedisClusterMessageListener = (
  message: RedisClusterMessage,
  streamId: string,
) => void | Promise<void>;

export class RedisCoordinator {
  readonly #listeners = new Map<string, Set<RedisClusterMessageListener>>();

  readonly #commandClient: RedisClient;
  readonly #streamClient: RedisClient;
  readonly #streamName: string;
  readonly #readCount: number;
  readonly #blockMs: number;
  readonly #maxLen?: number;
  readonly #onError?: (error: Error) => void;

  #offset = "$";
  #started = false;
  #closed = false;
  #pollPromise?: Promise<void>;

  constructor(options: RedisCoordinatorOptions) {
    this.#commandClient = options.commandClient;
    this.#streamClient = options.streamClient;
    this.#streamName = options.streamName;
    this.#readCount = options.readCount ?? 100;
    this.#blockMs = options.blockMs ?? 100;
    this.#maxLen = options.maxLen;
    this.#onError = options.onError;
  }

  addListener(scope: string, listener: RedisClusterMessageListener): () => void {
    const listeners = this.#listeners.get(scope) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(scope, listeners);

    return () => {
      const current = this.#listeners.get(scope);

      if (!current) {
        return;
      }

      current.delete(listener);

      if (current.size === 0) {
        this.#listeners.delete(scope);
      }
    };
  }

  async start(): Promise<void> {
    if (this.#closed) {
      throw new Error("Redis coordinator is closed.");
    }

    if (this.#started) {
      return;
    }

    if (!this.#commandClient.connected) {
      await this.#commandClient.connect();
    }

    if (!this.#streamClient.connected) {
      await this.#streamClient.connect();
    }

    this.#started = true;
    this.#pollPromise = this.#pollLoop();
  }

  async publish(message: RedisClusterMessage): Promise<string> {
    await this.start();
    return xadd(
      this.#commandClient,
      this.#streamName,
      encodeRedisClusterMessage(message),
      { maxLen: this.#maxLen },
    );
  }

  async close(): Promise<void> {
    this.#closed = true;

    try {
      await this.#pollPromise;
    } catch {
      // Ignore poll loop shutdown errors.
    }
  }

  async #pollLoop(): Promise<void> {
    while (!this.#closed) {
      try {
        const entries = await xread(this.#streamClient, this.#streamName, this.#offset, {
          blockMs: this.#blockMs,
          count: this.#readCount,
        });

        for (const entry of entries) {
          this.#offset = entry.id;

          const message = decodeRedisClusterMessage(entry.fields);
          const listeners = this.#listeners.get(message.scope);

          if (!listeners || listeners.size === 0) {
            continue;
          }

          for (const listener of listeners) {
            await listener(message, entry.id);
          }
        }
      } catch (error) {
        if (this.#closed) {
          return;
        }

        this.#onError?.(toError(error));
        await Bun.sleep(this.#blockMs);
      }
    }
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
