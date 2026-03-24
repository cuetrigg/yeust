import type { BroadcastOptions } from "../emulsifiers/types.ts";
import type { PocketName, SocketId } from "../sockets/context.ts";
import { PocketIndex } from "./pocket-index.ts";

export interface NormalizedBroadcastOptions {
  readonly pockets: Set<PocketName>;
  readonly except: Set<PocketName>;
  readonly socketIds: Set<SocketId>;
  readonly flags: BroadcastOptions["flags"];
}

export function normalizeBroadcastOptions(
  options: BroadcastOptions = {},
): NormalizedBroadcastOptions {
  return {
    pockets: new Set(options.pockets ?? []),
    except: new Set(options.except ?? []),
    socketIds: new Set(options.socketIds ?? []),
    flags: options.flags,
  };
}

export function selectSocketIds(
  pocketIndex: PocketIndex,
  options: BroadcastOptions = {},
): Set<SocketId> {
  const normalized = normalizeBroadcastOptions(options);
  const selected =
    normalized.socketIds.size > 0
      ? new Set(normalized.socketIds)
      : normalized.pockets.size > 0
        ? selectSocketIdsFromPockets(pocketIndex, normalized.pockets)
        : new Set(pocketIndex.getAllSocketIds());

  for (const socketId of selectSocketIdsFromPockets(pocketIndex, normalized.except)) {
    selected.delete(socketId);
  }

  return selected;
}

function selectSocketIdsFromPockets(
  pocketIndex: PocketIndex,
  pockets: Iterable<PocketName>,
): Set<SocketId> {
  const socketIds = new Set<SocketId>();

  for (const pocket of pockets) {
    for (const socketId of pocketIndex.getSocketIds(pocket)) {
      socketIds.add(socketId);
    }
  }

  return socketIds;
}
