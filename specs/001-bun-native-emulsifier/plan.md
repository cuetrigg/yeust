# Implementation Plan: Bun Native Redis Emulsifier

**Branch**: `[001-bun-native-emulsifier]` | **Date**: 2026-03-24 | **Spec**: `specs/001-bun-native-emulsifier/spec.md`
**Input**: Feature specification from `specs/001-bun-native-emulsifier/spec.md`

## Summary

Build a transport-neutral emulsifier contract for Yeust, backed by a local in-memory pocket index and a first distributed implementation that uses Bun native WebSockets plus Bun Redis Streams. The initial release focuses on pocket lifecycle events, clustered broadcasting, acknowledgement fan-in, node liveness, and connection state recovery for multi-instance websocket deployments running behind Docker Swarm or other load balancers.

## Technical Context

**Language/Version**: TypeScript 5.x on Bun 1.3.x  
**Primary Dependencies**: Bun native `Bun.serve()`, `ServerWebSocket`, and `RedisClient`  
**Storage**: In-memory socket/pocket maps plus Redis Streams and Redis string keys  
**Testing**: `bun test` for unit and integration coverage  
**Target Platform**: Linux containers and multi-instance websocket deployments in Docker Swarm  
**Project Type**: Library  
**Performance Goals**: Deliver clustered pocket broadcasts with one cluster envelope per operation, preserve replayable events within configured Redis retention, and avoid indefinite waits when nodes disappear  
**Constraints**: Bun-native runtime only, no Socket.IO runtime, no `ws`, no `ioredis`, transport-neutral public API, multi-node correctness before optimization  
**Scale/Scope**: Multiple websocket nodes behind a load balancer, many concurrent pockets, one Redis deployment shared across nodes, first transport is Redis with room for future emulsifiers

## Constitution Check

No `.specify/memory/constitution.md` exists in this repository yet. For this feature, apply the following temporary gates before implementation and re-check them after Phase 1 design:

- **Bun-native runtime only**: Pass. The plan uses Bun WebSockets and Bun Redis exclusively.
- **Transport-neutral public API**: Pass. The plan separates the `Emulsifier` contract from the Redis transport details.
- **Distributed correctness must be automated**: Pass. The plan includes unit and multi-node integration coverage for all required behaviors.
- **No hidden single-node assumptions**: Pass. The plan includes node heartbeat, shutdown handling, ack fan-in, and recovery across nodes.

## Project Structure

### Documentation (this feature)

```text
specs/001-bun-native-emulsifier/
├── plan.md
├── spec.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── emulsifiers/
│   ├── base-emulsifier.ts
│   ├── factory.ts
│   ├── index.ts
│   ├── memory-emulsifier.ts
│   ├── types.ts
│   └── redis/
│       ├── codec.ts
│       ├── coordinator.ts
│       ├── heartbeat.ts
│       ├── index.ts
│       ├── messages.ts
│       ├── recovery-store.ts
│       └── stream-commands.ts
├── pockets/
│   ├── pocket-index.ts
│   └── selectors.ts
├── protocol/
│   ├── ack.ts
│   ├── frames.ts
│   └── recovery.ts
├── sockets/
│   ├── context.ts
│   └── registry.ts
└── index.ts

tests/
├── integration/
│   └── redis/
└── unit/
```

**Structure Decision**: Use a single-library `src/` plus `tests/` layout. Keep local pocket logic, websocket protocol helpers, and Redis-specific cluster transport logic in separate directories so additional emulsifiers can be added later without rewriting the public contract.

## Research Findings

### Bun-native constraints

- Bun websocket topics (`ws.subscribe()`, `ws.publish()`, `server.publish()`) are process-local only and cannot provide clustered pocket delivery by themselves.
- Bun `RedisClient` supports Pub/Sub, but subscribed clients cannot safely perform the general command mix needed for clustered requests and recovery. Separate Redis clients are required whenever blocking reads or subscriptions are used.
- Bun `RedisClient` does not expose typed stream helpers for all needed Redis Stream operations, so the Redis emulsifier should wrap `RedisClient.send()` behind typed helper functions.
- Bun does not provide Socket.IO-style acknowledgement callbacks at the transport layer, so acknowledgements must be implemented as library-level protocol frames and tracked with message ids.

### Socket.IO adapter takeaways applied to Yeust

- The local source of truth should remain a bidirectional in-memory membership index: `pockets -> socket ids` and `socket ids -> pockets`.
- A distributed emulsifier should assign each node a unique id, ignore self-messages, and use request ids for fan-out/fan-in workflows.
- Redis Streams are a better fit than Pub/Sub for this feature because they support replay and recovery from temporary Redis disconnects.
- A single Redis stream per application or cluster is simpler than one stream per pocket; all nodes can consume the same stream and route messages in-process.
- Connection recovery is simpler and more reliable when the library stores session snapshots in Redis keys and uses the Redis stream itself as the replay log.

## Design Overview

### Selected architecture

The implementation is split into two layers:

1. **Local emulsifier layer**
   - Owns socket registration, pocket membership, and lifecycle event emission.
   - Performs target resolution for `all`, `in`, `except`, and direct socket fanout.
   - Sends frames to local `ServerWebSocket` instances and tracks local ack expectations.

2. **Cluster transport layer**
   - Publishes cluster envelopes to Redis Streams.
   - Consumes Redis Stream entries in a shared poll loop.
   - Replays remote operations through the same local emulsifier code path.
   - Tracks remote nodes, cluster request state, and recovery storage.

### Public contract

```ts
export interface Emulsifier {
  addSocket(context: SocketContext): void;
  removeSocket(socketId: string): void;
  join(socketId: string, pockets: string[]): Promise<void> | void;
  leave(socketId: string, pockets: string[]): Promise<void> | void;
  broadcast(frame: OutboundFrame, options: BroadcastOptions): Promise<void> | void;
  broadcastWithAck(frame: OutboundFrame, options: AckBroadcastOptions): Promise<AckResult>;
  persistSession(session: RecoverySession): Promise<void> | void;
  restoreSession(sessionId: string, offset: string): Promise<RecoveredSession | null>;
  close(): Promise<void> | void;
}
```

### Core implementations

- **`BaseEmulsifier`**: Shared local state and lifecycle behavior.
- **`MemoryEmulsifier`**: Single-node implementation used for development, tests, and the baseline transport-neutral contract.
- **`RedisStreamsEmulsifier`**: Distributed implementation that layers clustered delivery, ack fan-in, liveness, and recovery on top of the base emulsifier.
- **`EmulsifierFactory`**: Runtime selection between `memory`, `redis`, and future emulsifier types.

## Cluster Message Model

### Message types

The Redis emulsifier should define a compact cluster envelope with these message types:

- `INITIAL_HEARTBEAT`
- `HEARTBEAT`
- `BROADCAST`
- `POCKETS_JOIN`
- `POCKETS_LEAVE`
- `BROADCAST_CLIENT_COUNT`
- `BROADCAST_ACK`
- `ADAPTER_CLOSE`

Optional later message types can include `FETCH_SOCKETS`, `FETCH_SOCKETS_RESPONSE`, and `DISCONNECT_SOCKETS`, but they are not required to satisfy the current feature scope.

### Envelope shape

```ts
type ClusterEnvelope = {
  uid: string;
  scope: string;
  type: ClusterMessageType;
  requestId?: string;
  data?: unknown;
};
```

- `uid` identifies the sending node.
- `scope` isolates one Yeust application or namespace from another on the same Redis deployment.
- `requestId` correlates distributed ack and future request/response flows.

## Data Model Snapshot

### Socket context

- `sid`: public socket id
- `pid`: private recovery session id
- `ws`: Bun `ServerWebSocket`
- `pockets`: `Set<string>`
- `data`: arbitrary application data
- `lastOffset`: last processed recovery offset

### Pocket membership index

- `pockets: Map<string, Set<string>>`
- `socketPockets: Map<string, Set<string>>`

### Recovery session

- `pid`
- `sid`
- `pockets`
- `data`
- TTL enforced by Redis

### Ack request

- `requestId`
- `expected`
- `received`
- `responses`
- `timeoutAt`
- `timedOut`

## Redis Design

### Redis topology inside the emulsifier

Use at least two Redis clients derived from the same connection settings:

- `commandClient`: `XADD`, `XRANGE`, `SET`, `GETDEL`, and heartbeat writes
- `streamClient`: blocking `XREAD` loop for stream consumption

If later features add Pub/Sub or other dedicated workloads, they should use additional duplicated clients rather than multiplexing responsibilities onto the blocking stream reader.

### Stream and key names

Use configurable names with a safe default and Redis Cluster compatibility in mind:

- Stream: `yeust:{cluster}:stream`
- Recovery session: `yeust:{cluster}:session:{pid}`

The hash tag form (`{cluster}`) keeps stream and session keys colocated if Redis Cluster support is needed later.

### Encoding strategy

Use a Bun-native codec rather than pulling in a Socket.IO-specific parser stack:

- JSON for control metadata and JSON-safe payloads
- Base64 for binary websocket payloads and recovery-safe encoded frames

This keeps the first implementation Bun-native while still allowing binary-safe envelopes over Redis Stream string fields.

## Broadcast and Ack Design

### Local delivery

- Resolve targeted sockets from the pocket membership index.
- Send frames directly with `ws.send()` so include/exclude rules, offsets, and ack metadata are consistent.
- Inspect Bun websocket send status and buffered amount to record backpressure or drop behavior without corrupting cluster state.

### Distributed delivery

- Origin node publishes `BROADCAST` to Redis Streams.
- Every active node consumes the envelope and re-runs local delivery for matching sockets.
- Nodes ignore self-messages and mismatched scopes.

### Ack fan-in

- Ack-enabled broadcasts include a `requestId`.
- Each node reports one `BROADCAST_CLIENT_COUNT` for the number of local targets.
- Each client ack becomes one `BROADCAST_ACK` response routed back to the origin.
- The origin resolves the final result when either all expected acks arrive or the timeout elapses.

Recommended public ack result:

```ts
type AckResult = {
  expected: number;
  received: number;
  responses: unknown[];
  timedOut: boolean;
};
```

## Connection Recovery Design

### Session persistence

- On disconnect, persist a recovery session snapshot in Redis under `yeust:{cluster}:session:{pid}`.
- Store pockets, socket data, and recovery identifiers with a TTL equal to `maxDisconnectionDuration`.

### Replay log

- Every replayable clustered broadcast receives the Redis stream entry id as its recovery offset.
- Volatile events and ack-dependent events are excluded from replay.

### Restore flow

1. Validate the client-provided offset format.
2. `GETDEL` the recovery session key so one recovery attempt consumes the snapshot.
3. Confirm the offset still exists in the Redis stream.
4. Read forward with `XRANGE(nextOffset(offset), "+")`.
5. Filter entries to the current scope and the client's prior pockets.
6. Append missed replayable frames to the restored session result in stream order.

### Ownership boundary

The emulsifier owns session persistence and replay filtering. The higher-level websocket/session layer remains responsible for deciding how clients provide `pid` and `offset` on reconnect.

## Delivery Phases

### Phase 1 - Local contract and memory emulsifier

- Core types
- socket and pocket indexes
- lifecycle events
- local broadcast and direct ack tracking
- dynamic factory with `memory` support

### Phase 2 - Redis Streams clustered pockets

- typed stream helpers around Bun `RedisClient.send()`
- cluster envelope codec
- shared process-level poll loop
- clustered join, leave, and broadcast
- heartbeat and graceful shutdown

### Phase 3 - Distributed acknowledgements

- ack request tracking
- `BROADCAST_CLIENT_COUNT` and `BROADCAST_ACK`
- timeout and partial-result behavior

### Phase 4 - Connection recovery

- Redis recovery store
- replayable frame rules
- restore and replay flow
- failure handling for expired sessions and trimmed offsets

## Risks and Mitigations

- **Bun Redis stream parsing is low-level**: Wrap all raw `send()` usage behind typed helpers and test reply parsing heavily.
- **Bun websocket ack semantics are not built-in**: Standardize a Yeust-level frame protocol with explicit ack ids.
- **Slow or dead nodes can stall clustered waits**: Use heartbeat tracking and remove timed-out nodes from pending requests.
- **Redis stream trimming can break recovery**: Make retention configurable and return a clean fresh-session fallback when the offset no longer exists.
- **Backpressure can make local delivery uneven**: Surface send status and buffered amount to the caller or logs, but keep membership state authoritative and consistent.

## Complexity Tracking

No constitution violations are currently identified.
