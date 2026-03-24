import type {
  RecoveredSession,
  RecoverySession,
} from "../protocol/recovery.ts";
import type { RecoverySessionId } from "../sockets/context.ts";
import { BaseEmulsifier } from "./base-emulsifier.ts";
import { emulsifierFactory } from "./factory.ts";

export class MemoryEmulsifier<
  TSocketData = unknown,
  TSessionData = unknown,
> extends BaseEmulsifier<TSocketData, TSessionData> {
  readonly #sessions = new Map<RecoverySessionId, RecoverySession<TSessionData>>();

  constructor() {
    super("memory", {
      acknowledgements: true,
      connectionStateRecovery: true,
    });
  }

  override persistSession(session: RecoverySession<TSessionData>): void {
    this.#sessions.set(session.sessionId, session);
  }

  override async restoreSession(
    sessionId: RecoverySessionId,
    _offset: string,
  ): Promise<RecoveredSession<TSessionData> | null> {
    const session = this.#sessions.get(sessionId);

    if (!session) {
      return null;
    }

    this.#sessions.delete(sessionId);
    return {
      ...session,
      missedFrames: [],
    };
  }

  override close(): void {
    this.#sessions.clear();
    this.sockets.clear();
    this.pockets.clear();
  }
}

export function createMemoryEmulsifier(): MemoryEmulsifier {
  return new MemoryEmulsifier();
}

emulsifierFactory.register("memory", () => createMemoryEmulsifier());
