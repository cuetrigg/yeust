import type { RedisClient } from "bun";
import type {
  RecoveredSession,
  RecoverySession,
} from "../../protocol/recovery.ts";

export interface RedisRecoveryStoreOptions {
  readonly client: RedisClient;
  readonly sessionKeyPrefix: string;
  readonly sessionTtlMs: number;
}

export class RedisRecoveryStore<TSessionData = unknown> {
  readonly #client: RedisClient;
  readonly #sessionKeyPrefix: string;
  readonly #sessionTtlMs: number;

  constructor(options: RedisRecoveryStoreOptions) {
    this.#client = options.client;
    this.#sessionKeyPrefix = options.sessionKeyPrefix;
    this.#sessionTtlMs = options.sessionTtlMs;
  }

  async persist(session: RecoverySession<TSessionData>): Promise<void> {
    await this.#client.set(
      this.#getSessionKey(session.sessionId),
      JSON.stringify(session),
      "PX",
      this.#sessionTtlMs,
    );
  }

  async consume(sessionId: string): Promise<RecoverySession<TSessionData> | null> {
    const value = await this.#client.getdel(this.#getSessionKey(sessionId));

    if (!value) {
      return null;
    }

    return JSON.parse(value) as RecoverySession<TSessionData>;
  }

  createRecoveredSession(
    session: RecoverySession<TSessionData>,
    missedFrames: RecoveredSession<TSessionData>["missedFrames"],
  ): RecoveredSession<TSessionData> {
    return {
      ...session,
      missedFrames,
    };
  }

  #getSessionKey(sessionId: string): string {
    return `${this.#sessionKeyPrefix}${sessionId}`;
  }
}
