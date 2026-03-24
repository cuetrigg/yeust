# Feature Specification: Bun Native Redis Emulsifier

**Feature Branch**: `[001-bun-native-emulsifier]`  
**Created**: 2026-03-24  
**Status**: Draft  
**Input**: User description: "Use native Bun as the runtime/toolkit for a pocket-based websocket library. Implement a dynamic emulsifier abstraction where emulsifiers manage socket-to-pocket relationships and clustered broadcasting. The first distributed emulsifier must use Bun native WebSockets and Bun Redis, support multi-instance deployments in Docker Swarm, emit pocket lifecycle events (`create`, `delete`, `join`, `leave`), and provide socket management, inter-server communication, broadcast with acknowledgements, and connection state recovery."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configure a clustered pocket emulsifier (Priority: P1)

As a library integrator, I can choose an emulsifier implementation by configuration and use the same pocket API whether the server is running in-memory on one node or distributed across multiple Bun websocket instances.

**Why this priority**: This is the core capability that makes pockets usable in real multi-instance deployments and establishes the transport-neutral contract needed for future emulsifiers.

**Independent Test**: Start two Bun websocket servers with the `redis` emulsifier and one server with the `memory` emulsifier in isolated tests. Verify the same public pocket API works in both cases, and that a pocket broadcast from one Redis-backed node reaches matching clients connected to both Redis-backed nodes.

**Acceptance Scenarios**:

1. **Given** the library is configured with the `memory` emulsifier, **When** sockets join and leave pockets on a single server, **Then** the server manages pocket membership locally and emits `create`, `join`, `leave`, and `delete` lifecycle events in the correct order.
2. **Given** the library is configured with the `redis` emulsifier on multiple Bun websocket instances, **When** a socket joins a pocket on node A and another socket joins the same pocket on node B, **Then** a broadcast to that pocket reaches both sockets exactly once.
3. **Given** a broadcast targets one or more pockets with an `except` filter, **When** clustered delivery is performed, **Then** only sockets matching the include filters and not matching the exclude filters receive the event.
4. **Given** a previously unseen pocket receives its first member, **When** the join completes, **Then** the emulsifier emits `create` before the pocket becomes available for broadcast, and emits `delete` when the final member leaves.

---

### User Story 2 - Collect acknowledgements across nodes (Priority: P2)

As a library integrator, I can broadcast an event that expects acknowledgements and receive aggregated ack results even when the targeted clients are connected to different Bun websocket instances.

**Why this priority**: Once clustered delivery works, acknowledgement support is the next most important correctness feature because it allows higher-level workflows to know whether targeted clients actually processed an event.

**Independent Test**: Run two Redis-backed Bun websocket servers with multiple clients spread across both nodes. Broadcast an ack-enabled event to a shared pocket and verify the caller receives the expected client count, collected responses, and timeout metadata when one or more clients do not acknowledge in time.

**Acceptance Scenarios**:

1. **Given** an ack-enabled broadcast targets clients on multiple nodes, **When** all clients acknowledge before the timeout, **Then** the caller receives the full aggregated response set and the final result reports no timeout.
2. **Given** an ack-enabled broadcast targets clients on multiple nodes, **When** only a subset of clients acknowledge before the timeout, **Then** the caller receives the partial responses collected so far and timeout metadata showing the missing acknowledgements.
3. **Given** an ack-enabled broadcast targets no matching clients, **When** the request completes, **Then** the caller receives a successful result with zero expected acknowledgements and zero responses.

---

### User Story 3 - Recover connection state after reconnecting to another node (Priority: P3)

As a reconnecting client, I can reconnect to any Bun websocket instance in the cluster and recover my pocket memberships plus replayable events that were missed while I was temporarily disconnected.

**Why this priority**: Connection state recovery is a high-value scaling feature for Docker Swarm and load-balanced deployments, but it depends on the core clustered pocket and broadcast behavior already working.

**Independent Test**: Connect a client to node A, join one or more pockets, disconnect it, emit replayable events while it is away, reconnect it to node B within the configured recovery window, and verify that the restored session contains the original pockets plus the missed replayable events after the last known offset.

**Acceptance Scenarios**:

1. **Given** a client disconnects with a valid recovery session and reconnects to a different node before the recovery TTL expires, **When** it presents its recovery identifiers and last processed offset, **Then** the library restores the client session and replays the eligible missed events in order.
2. **Given** the reconnecting client presents an expired session or an offset that has already been trimmed from Redis, **When** recovery is attempted, **Then** the library rejects recovery cleanly and establishes a fresh session instead.
3. **Given** a missed event was marked volatile or required an acknowledgement callback, **When** recovery is performed, **Then** that event is not replayed as part of the recovered session.

### Edge Cases

- A socket attempts to join the same pocket more than once.
- A socket leaves a pocket it is not currently in.
- A Redis-backed node stops heartbeating during an in-flight clustered request.
- Redis becomes temporarily unavailable while broadcasts or recovery operations are pending.
- A broadcast encounters websocket backpressure or a dropped send result on only some targeted sockets.
- The Redis stream trims past a client's last known offset before the client reconnects.
- A graceful shutdown occurs while pockets still exist on the node.
- An ack-enabled broadcast targets both local and remote sockets, but only the local sockets acknowledge.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The library MUST expose a transport-neutral `Emulsifier` abstraction for pocket membership, clustered delivery, and recovery behavior.
- **FR-002**: The library MUST support selecting an emulsifier dynamically by configuration, and MUST provide at least `memory` and `redis` emulsifier types behind the same public contract.
- **FR-003**: The emulsifier MUST manage bidirectional socket-to-pocket and pocket-to-socket relationships for locally connected sockets.
- **FR-004**: The emulsifier MUST emit pocket lifecycle events named `create`, `delete`, `join`, and `leave`.
- **FR-005**: The implementation MUST integrate with Bun native websocket connections created through `Bun.serve()` and `ServerWebSocket`.
- **FR-006**: The first distributed emulsifier MUST use Bun `RedisClient` and Redis Streams as the cluster coordination transport.
- **FR-007**: The Redis emulsifier MUST broadcast to all sockets, one pocket, many pockets, and pocket filters with exclusions across all active nodes.
- **FR-008**: The Redis emulsifier MUST include node identity and request identity in cluster messages so remote nodes can ignore self-messages and correlate distributed requests.
- **FR-009**: The Redis emulsifier MUST provide inter-server communication needed for clustered broadcasts, acknowledgement fan-in, heartbeat messages, and graceful adapter shutdown.
- **FR-010**: The Redis emulsifier MUST support broadcast acknowledgements across nodes and return expected client count, collected responses, and timeout status to the caller.
- **FR-011**: The Redis emulsifier MUST track node liveness with a heartbeat mechanism and MUST exclude dead nodes from pending cluster waits after timeout detection.
- **FR-012**: The Redis emulsifier MUST persist recoverable session state in Redis with a configurable recovery TTL.
- **FR-013**: The Redis emulsifier MUST replay only eligible missed events after reconnect by filtering the Redis stream with the client's prior pockets and exclusion rules.
- **FR-014**: Replayable events MUST carry a recovery offset so reconnecting clients can resume from the last processed cluster message.
- **FR-015**: Volatile events and events that depend on in-memory acknowledgement callbacks MUST NOT be included in recovery replay.
- **FR-016**: The implementation MUST expose Redis stream and key naming options so multiple applications or environments can safely share a Redis deployment.
- **FR-017**: Redis command usage MUST be encapsulated behind internal helpers so future emulsifier implementations can reuse the public contract without leaking Redis-specific details.
- **FR-018**: The feature MUST be verifiable through automated unit and multi-node integration scenarios covering pocket membership, clustered broadcasting, acknowledgements, liveness, and recovery.

### Key Entities *(include if feature involves data)*

- **Emulsifier**: The server-side component that owns local socket membership, pocket lifecycle events, and the transport bridge used to coordinate clustered operations.
- **Socket Context**: The local record for a websocket connection, including the socket id, recovery session id, attached websocket instance, joined pockets, connection metadata, and any pending ack state.
- **Pocket Membership Index**: The bidirectional in-memory structure that maps pockets to socket ids and socket ids to pockets.
- **Cluster Envelope**: The serialized inter-server message containing node id, scope, type, request id, and the data required to replay a clustered operation on other nodes.
- **Recovery Session**: The Redis-persisted snapshot of a disconnected socket's recovery identifiers, prior pockets, application data, and expiry window.
- **Replayable Event**: A clustered broadcast record that can be stored, filtered, and replayed during connection recovery because it is durable and does not depend on transient callbacks.
- **Ack Request**: The tracked distributed request used to aggregate expected client count, received acknowledgements, timeout state, and response payloads for an ack-enabled broadcast.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In automated integration tests with two Redis-backed Bun websocket servers, 100% of targeted connected clients receive each clustered pocket broadcast exactly once, and 0 untargeted clients receive it.
- **SC-002**: In automated ack integration tests, the caller receives the correct `expected`, `received`, and `responses` values for both full-success and partial-timeout cases.
- **SC-003**: In automated recovery tests, a client that reconnects within the recovery TTL restores its prior pocket memberships and receives the ordered set of eligible missed events after its last processed offset.
- **SC-004**: In automated liveness tests, a node that stops heartbeating is removed from pending cluster waits within the configured heartbeat timeout window, preventing indefinite ack or fetch waits.
- **SC-005**: Switching from `memory` to `redis` emulsifier configuration does not require the library integrator to rewrite pocket membership or broadcast calling code.
