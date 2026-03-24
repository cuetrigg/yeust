---

description: "Task list for implementing the Bun native Redis emulsifier feature"

---

# Tasks: Bun Native Redis Emulsifier

**Input**: Design documents from `specs/001-bun-native-emulsifier/`  
**Prerequisites**: `spec.md`, `plan.md`  
**Tests**: This feature explicitly requires automated unit and multi-node integration verification.  
**Organization**: Tasks are grouped by user story so each story can be implemented and validated as an incremental delivery.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (`US1`, `US2`, `US3`)
- Include exact file paths in descriptions

## Path Conventions

- Source code lives in `src/`
- Automated tests live in `tests/unit/` and `tests/integration/`
- Redis-backed cluster integration tests live in `tests/integration/redis/`

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the project structure and feature entry points required by every user story.

- [ ] T001 Create the feature directory structure under `src/emulsifiers/`, `src/emulsifiers/redis/`, `src/pockets/`, `src/protocol/`, `src/sockets/`, `tests/unit/`, and `tests/integration/redis/`
- [ ] T002 Create public library entry points in `src/index.ts` and `src/emulsifiers/index.ts`
- [ ] T003 [P] Create shared Redis integration test helpers in `tests/integration/redis/helpers/redis.ts` and `tests/integration/redis/helpers/cluster.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the transport-neutral contract and local data structures that every story depends on.

**CRITICAL**: No user story work should start until this phase is complete.

- [ ] T004 Define shared emulsifier contracts and option types in `src/emulsifiers/types.ts`
- [ ] T005 [P] Define socket context and registry helpers in `src/sockets/context.ts` and `src/sockets/registry.ts`
- [ ] T006 [P] Implement the bidirectional pocket membership index in `src/pockets/pocket-index.ts`
- [ ] T007 [P] Implement target selection helpers for include/exclude pocket filters in `src/pockets/selectors.ts`
- [ ] T008 Implement shared local lifecycle behavior in `src/emulsifiers/base-emulsifier.ts`
- [ ] T009 [P] Define websocket frame shapes and message ids in `src/protocol/frames.ts`
- [ ] T010 [P] Define ack result types and timers in `src/protocol/ack.ts`
- [ ] T011 [P] Define recovery session and offset helpers in `src/protocol/recovery.ts`
- [ ] T012 Implement the dynamic emulsifier registry and factory in `src/emulsifiers/factory.ts`

**Checkpoint**: The transport-neutral contract, pocket index, and protocol types are ready.

---

## Phase 3: User Story 1 - Configure a clustered pocket emulsifier (Priority: P1) 🎯 MVP

**Goal**: Deliver a working `memory` emulsifier plus a Redis Streams emulsifier that can coordinate pockets and clustered broadcasts across Bun websocket nodes.

**Independent Test**: Start two Bun websocket servers backed by Redis and verify that pocket membership, lifecycle events, and clustered broadcasts work across nodes without changing the public pocket API.

### Tests for User Story 1 ⚠️

> Write these tests first and confirm they fail before implementing the story.

- [ ] T013 [P] [US1] Add pocket index lifecycle tests in `tests/unit/pockets/pocket-index.test.ts`
- [ ] T014 [P] [US1] Add memory emulsifier behavior tests in `tests/unit/emulsifiers/memory-emulsifier.test.ts`
- [ ] T015 [P] [US1] Add clustered pocket broadcast integration coverage in `tests/integration/redis/pocket-broadcast.test.ts`

### Implementation for User Story 1

- [ ] T016 [P] [US1] Implement the single-node `MemoryEmulsifier` in `src/emulsifiers/memory-emulsifier.ts`
- [ ] T017 [P] [US1] Implement Redis stream command wrappers around Bun `RedisClient.send()` in `src/emulsifiers/redis/stream-commands.ts`
- [ ] T018 [P] [US1] Define Redis cluster message types and payloads in `src/emulsifiers/redis/messages.ts`
- [ ] T019 [P] [US1] Implement Redis envelope encode/decode helpers in `src/emulsifiers/redis/codec.ts`
- [ ] T020 [US1] Implement the shared Redis stream poll loop and adapter dispatcher in `src/emulsifiers/redis/coordinator.ts`
- [ ] T021 [US1] Implement Redis-backed join, leave, and broadcast behavior in `src/emulsifiers/redis/index.ts`
- [ ] T022 [US1] Wire Bun `ServerWebSocket` registration, removal, and lifecycle event emission into `src/emulsifiers/base-emulsifier.ts`
- [ ] T023 [US1] Export `memory` and `redis` emulsifier types from `src/emulsifiers/index.ts` and `src/index.ts`

**Checkpoint**: The same public pocket API works with both `memory` and `redis`, and clustered pocket broadcasts succeed across Bun nodes.

---

## Phase 4: User Story 2 - Collect acknowledgements across nodes (Priority: P2)

**Goal**: Add distributed acknowledgement support for clustered broadcasts.

**Independent Test**: Broadcast an ack-enabled event to clients on multiple Redis-backed nodes and verify the caller receives full or partial results with correct timeout metadata.

### Tests for User Story 2 ⚠️

- [ ] T024 [P] [US2] Add ack timer and aggregation unit tests in `tests/unit/protocol/ack.test.ts`
- [ ] T025 [P] [US2] Add clustered broadcast acknowledgement integration coverage in `tests/integration/redis/broadcast-ack.test.ts`

### Implementation for User Story 2

- [ ] T026 [P] [US2] Implement local ack request tracking and completion helpers in `src/protocol/ack.ts`
- [ ] T027 [US2] Extend Redis message definitions with `BROADCAST_CLIENT_COUNT` and `BROADCAST_ACK` in `src/emulsifiers/redis/messages.ts`
- [ ] T028 [US2] Implement local websocket ack fan-out and timeout handling in `src/emulsifiers/base-emulsifier.ts`
- [ ] T029 [US2] Implement cross-node ack fan-in and final result resolution in `src/emulsifiers/redis/index.ts`

**Checkpoint**: Ack-enabled clustered broadcasts return the correct expected count, collected responses, and timeout state.

---

## Phase 5: User Story 3 - Recover connection state after reconnecting to another node (Priority: P3)

**Goal**: Persist recoverable session state in Redis and replay eligible missed events after reconnect.

**Independent Test**: Disconnect a client from one node, emit replayable events while it is away, reconnect it to another node within the TTL, and verify its pockets and missed events are restored.

### Tests for User Story 3 ⚠️

- [ ] T030 [P] [US3] Add recovery offset and replay eligibility unit tests in `tests/unit/protocol/recovery.test.ts`
- [ ] T031 [P] [US3] Add successful reconnect-and-replay integration coverage in `tests/integration/redis/connection-recovery.test.ts`
- [ ] T032 [P] [US3] Add expired-session and trimmed-offset integration coverage in `tests/integration/redis/recovery-failures.test.ts`

### Implementation for User Story 3

- [ ] T033 [P] [US3] Implement the Redis recovery store in `src/emulsifiers/redis/recovery-store.ts`
- [ ] T034 [P] [US3] Implement replayable frame rules and offset injection in `src/protocol/recovery.ts`
- [ ] T035 [US3] Persist recovery sessions on disconnect in `src/emulsifiers/base-emulsifier.ts` and `src/emulsifiers/redis/index.ts`
- [ ] T036 [US3] Implement restore-session and replay filtering logic in `src/emulsifiers/redis/index.ts`
- [ ] T037 [US3] Document recovery session and reconnect requirements in `README.md`

**Checkpoint**: Reconnecting clients can restore pockets and replay eligible missed events across nodes.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Harden clustered behavior and finish delivery-quality documentation.

- [ ] T038 [P] Add heartbeat and dead-node handling integration coverage in `tests/integration/redis/cluster-liveness.test.ts`
- [ ] T039 Implement heartbeat scheduling, node pruning, and graceful `ADAPTER_CLOSE` handling in `src/emulsifiers/redis/heartbeat.ts` and `src/emulsifiers/redis/index.ts`
- [ ] T040 [P] Document Redis key naming, stream retention, and Docker Swarm deployment guidance in `README.md`
- [ ] T041 Run `bun test` and fix any failing unit or integration tests
- [ ] T042 Run `bunx tsc --noEmit` and fix any reported type errors

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Setup and blocks every user story
- **User Story 1 (Phase 3)**: Depends on Foundational and establishes the clustered pocket baseline
- **User Story 2 (Phase 4)**: Depends on User Story 1 because ack fan-in builds on clustered broadcast delivery
- **User Story 3 (Phase 5)**: Depends on User Story 1 because recovery reuses the Redis Streams clustered delivery path
- **Polish (Phase 6)**: Depends on all targeted user stories being complete

### User Story Dependencies

- **US1**: No dependencies beyond the foundational contract
- **US2**: Requires the clustered broadcast path from US1, but remains independently testable once that path exists
- **US3**: Requires the Redis stream and clustered envelope path from US1, but remains independently testable once that path exists

### Within Each User Story

- Write the story tests first and confirm they fail
- Implement types and helpers before transport coordination
- Implement transport coordination before high-level exports and docs
- Finish the story and re-run its tests before moving on

### Parallel Opportunities

- `T003`, `T005`, `T006`, `T007`, `T009`, `T010`, and `T011` can run in parallel during setup/foundational work
- All test tasks marked `[P]` inside a story can run in parallel
- Within US1, `T016`, `T017`, `T018`, and `T019` can run in parallel after the foundational phase
- Within US3, `T033` and `T034` can run in parallel before the final restore flow work

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Setup
2. Complete Foundational
3. Complete User Story 1
4. Validate clustered pockets and lifecycle events across Bun nodes
5. Stop for review before moving to acks and recovery

### Incremental Delivery

1. Ship the transport-neutral contract plus `memory` and `redis` clustered pockets
2. Add distributed acknowledgements
3. Add connection recovery
4. Harden heartbeat and deployment behavior

### Notes

- Keep Redis-specific logic behind `src/emulsifiers/redis/`
- Keep pocket membership as the authoritative local source of truth
- Do not use Bun websocket topics as the correctness layer for clustered behavior
- Prefer Redis Streams over Pub/Sub for durable replay and recovery support
