import type { SocketContext, SocketId } from "./context.ts";

export class SocketRegistry<TSocketData = unknown, TSessionData = unknown>
  implements Iterable<[SocketId, SocketContext<TSocketData, TSessionData>]>
{
  readonly #contexts = new Map<
    SocketId,
    SocketContext<TSocketData, TSessionData>
  >();

  get size(): number {
    return this.#contexts.size;
  }

  register(
    context: SocketContext<TSocketData, TSessionData>,
  ): SocketContext<TSocketData, TSessionData> | undefined {
    const previous = this.#contexts.get(context.socketId);
    this.#contexts.set(context.socketId, context);
    return previous;
  }

  get(socketId: SocketId): SocketContext<TSocketData, TSessionData> | undefined {
    return this.#contexts.get(socketId);
  }

  has(socketId: SocketId): boolean {
    return this.#contexts.has(socketId);
  }

  remove(
    socketId: SocketId,
  ): SocketContext<TSocketData, TSessionData> | undefined {
    const context = this.#contexts.get(socketId);

    if (!context) {
      return undefined;
    }

    this.#contexts.delete(socketId);
    return context;
  }

  values(): IterableIterator<SocketContext<TSocketData, TSessionData>> {
    return this.#contexts.values();
  }

  entries(): IterableIterator<
    [SocketId, SocketContext<TSocketData, TSessionData>]
  > {
    return this.#contexts.entries();
  }

  ids(): IterableIterator<SocketId> {
    return this.#contexts.keys();
  }

  clear(): void {
    this.#contexts.clear();
  }

  [Symbol.iterator](): IterableIterator<
    [SocketId, SocketContext<TSocketData, TSessionData>]
  > {
    return this.entries();
  }
}
