# yeust

`yeust` is a Bun-native websocket library built around pocket-based fanout.

The server-side coordination layer is called an `emulsifier`.

## Current feature set

- `memory` emulsifier for single-node development and local tests
- `redis` emulsifier backed by Bun `RedisClient` and Redis Streams
- pocket lifecycle events: `create`, `delete`, `join`, `leave`
- clustered broadcasts with include/exclude pocket targeting
- clustered broadcast acknowledgements
- connection state recovery with Redis-backed session storage and stream replay
- heartbeat-based node liveness and graceful node shutdown handling

## Install

```bash
bun install
```

## Examples

Checkout our example apps under `examples/`:

- `examples/in-memory-chat`
- `examples/swarm-chat`

Quick start:

```bash
cd examples/in-memory-chat
bun run dev
```

```bash
cd examples/swarm-chat
bun run dev
```

For clustered testing, follow `examples/swarm-chat/README.md`.

## Runtime assumptions

- Bun native websocket server via `Bun.serve()`
- Bun native Redis client via `RedisClient`
- Redis Streams for clustered message delivery

## Public entry points

The package currently exports the shared protocol and emulsifier primitives from `index.ts`.

Main types and factories:

- `createEmulsifier()`
- `emulsifierFactory`
- `MemoryEmulsifier`
- `RedisEmulsifier`

## Redis emulsifier notes

The Redis emulsifier uses:

- one Redis Stream for cluster envelopes
- one Redis Set for node discovery
- one Redis key prefix for recovery sessions

Default key patterns:

- stream: `yeust:{scope}:stream`
- nodes: `yeust:{scope}:nodes`
- sessions: `yeust:{scope}:session:{sessionId}`

The `{scope}` hash tag keeps related keys colocated if Redis Cluster is introduced later.

## Important Redis options

`RedisEmulsifier` currently supports these important options:

- `streamName`
- `nodesKey`
- `sessionKeyPrefix`
- `sessionTtlMs`
- `maxLen`
- `readCount`
- `blockMs`
- `heartbeatIntervalMs`
- `heartbeatTimeoutMs`

Guidance:

- increase `maxLen` if clients may reconnect after many broadcasts
- keep `heartbeatTimeoutMs` greater than `heartbeatIntervalMs`
- use separate Redis clients for command and stream workloads in production

## Acknowledgement flow

Ack-enabled broadcasts work in two layers:

1. the origin node sends the event locally and publishes a clustered broadcast
2. each remote node reports how many local sockets must ack
3. each client ack is forwarded back to the origin node
4. the origin resolves with:

```ts
type AckResult = {
  expected: number;
  received: number;
  responses: unknown[];
  timedOut: boolean;
};
```

Client acknowledgements are handed back into the emulsifier through `handleInboundFrame(socketId, frame)`.

## Connection recovery

Recovery works by:

1. persisting the disconnected socket session in Redis with TTL
2. attaching Redis Stream offsets to replayable broadcast frames
3. restoring a session with `restoreSession(sessionId, offset)`
4. replaying only eligible missed frames for the client's previous pockets

Frames are replayable only when they are:

- event frames
- not volatile
- not acknowledgement-dependent

## Docker Swarm deployment notes

This library is intended to run with multiple Bun websocket instances behind a load balancer.

Recommended deployment setup:

- run one shared Redis deployment reachable by all websocket nodes
- give every websocket service the same `scope`, `streamName`, and `sessionKeyPrefix`
- make sure sticky sessions are not required, because recovery is designed to work across nodes
- size Redis Stream retention for your reconnect window and traffic volume
- monitor heartbeat timeouts and Redis connection health

## Development

Run tests:

```bash
bun test
```

Run a type check:

```bash
bunx tsc --noEmit
```
