import type { PocketName, SocketId } from "../sockets/context.ts";

export type PocketIndexChangeType = "create" | "delete" | "join" | "leave";

export interface PocketIndexChange {
  readonly type: PocketIndexChangeType;
  readonly pocket: PocketName;
  readonly socketId?: SocketId;
}

export class PocketIndex {
  readonly #pockets = new Map<PocketName, Set<SocketId>>();
  readonly #socketPockets = new Map<SocketId, Set<PocketName>>();

  get pocketCount(): number {
    return this.#pockets.size;
  }

  get socketCount(): number {
    return this.#socketPockets.size;
  }

  hasPocket(pocket: PocketName): boolean {
    return this.#pockets.has(pocket);
  }

  hasSocket(socketId: SocketId): boolean {
    return this.#socketPockets.has(socketId);
  }

  getPockets(socketId: SocketId): ReadonlySet<PocketName> {
    return new Set(this.#socketPockets.get(socketId) ?? []);
  }

  getSocketIds(pocket: PocketName): ReadonlySet<SocketId> {
    return new Set(this.#pockets.get(pocket) ?? []);
  }

  getAllSocketIds(): ReadonlySet<SocketId> {
    return new Set(this.#socketPockets.keys());
  }

  join(socketId: SocketId, pockets: Iterable<PocketName>): PocketIndexChange[] {
    const changes: PocketIndexChange[] = [];
    let socketPockets = this.#socketPockets.get(socketId);

    if (!socketPockets) {
      socketPockets = new Set();
      this.#socketPockets.set(socketId, socketPockets);
    }

    for (const pocket of pockets) {
      if (socketPockets.has(pocket)) {
        continue;
      }

      let members = this.#pockets.get(pocket);

      if (!members) {
        members = new Set();
        this.#pockets.set(pocket, members);
        changes.push({ type: "create", pocket });
      }

      members.add(socketId);
      socketPockets.add(pocket);
      changes.push({ type: "join", pocket, socketId });
    }

    if (socketPockets.size === 0) {
      this.#socketPockets.delete(socketId);
    }

    return changes;
  }

  leave(socketId: SocketId, pockets: Iterable<PocketName>): PocketIndexChange[] {
    const changes: PocketIndexChange[] = [];
    const socketPockets = this.#socketPockets.get(socketId);

    if (!socketPockets) {
      return changes;
    }

    for (const pocket of pockets) {
      if (!socketPockets.has(pocket)) {
        continue;
      }

      const members = this.#pockets.get(pocket);

      if (!members) {
        continue;
      }

      members.delete(socketId);
      socketPockets.delete(pocket);
      changes.push({ type: "leave", pocket, socketId });

      if (members.size === 0) {
        this.#pockets.delete(pocket);
        changes.push({ type: "delete", pocket });
      }
    }

    if (socketPockets.size === 0) {
      this.#socketPockets.delete(socketId);
    }

    return changes;
  }

  removeSocket(socketId: SocketId): PocketIndexChange[] {
    return this.leave(socketId, Array.from(this.#socketPockets.get(socketId) ?? []));
  }

  clear(): void {
    this.#pockets.clear();
    this.#socketPockets.clear();
  }
}
