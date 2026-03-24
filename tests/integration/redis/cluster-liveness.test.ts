import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { RedisClient } from "bun";
import { RedisEmulsifier } from "../../../src/emulsifiers/redis/index.ts";
import {
  createAckFrame,
  parseFrame,
  withMessageId,
} from "../../../src/protocol/frames.ts";
import { createSocketContext } from "../../../src/sockets/context.ts";
import { createFakeServerWebSocket } from "../../helpers/fake-server-websocket.ts";
import {
  cleanupRedisTestScope,
  createRedisNodeId,
  createRedisTestScope,
} from "./helpers/cluster.ts";
import {
  createRedisClient,
  duplicateRedisClient,
  getRedisUrl,
  waitForRedis,
} from "./helpers/redis.ts";

const scope = createRedisTestScope("yeust-liveness-test");

let redisAvailable = false;
let leftCommand: Awaited<ReturnType<typeof createRedisClient>>;
let leftStream: Awaited<ReturnType<typeof duplicateRedisClient>>;

beforeAll(async () => {
  try {
    await waitForRedis(getRedisUrl(), 5, 50);
    redisAvailable = true;
    leftCommand = await createRedisClient();
    leftStream = await duplicateRedisClient(leftCommand);
  } catch {
    redisAvailable = false;
  }
});

afterAll(async () => {
  if (!redisAvailable) {
    return;
  }

  await cleanupRedisTestScope(leftCommand, scope);
  leftStream.close();
  leftCommand.close();
});

describe("RedisEmulsifier cluster liveness", () => {
  test("prunes dead nodes after heartbeat timeout so ack waits do not stall", async () => {
    if (!redisAvailable) {
      return;
    }

    const rightCommand = await createRedisClient();
    const rightStream = await duplicateRedisClient(rightCommand);
    const left = new RedisEmulsifier(
      {
        uid: createRedisNodeId("left"),
        commandClient: leftCommand,
        streamClient: leftStream,
        streamName: scope.streamName,
        heartbeatIntervalMs: 25,
        heartbeatTimeoutMs: 80,
      },
      { scope: scope.name },
    );
    const right = new RedisEmulsifier(
      {
        uid: createRedisNodeId("right"),
        commandClient: rightCommand,
        streamClient: rightStream,
        streamName: scope.streamName,
        heartbeatIntervalMs: 25,
        heartbeatTimeoutMs: 80,
      },
      { scope: scope.name },
    );

    try {
      const leftSocket = createFakeServerWebSocket({ socketId: "left-1" });

      left.addSocket(createSocketContext({ socketId: "left-1", ws: leftSocket.ws }));
      await left.join("left-1", ["alpha"]);
      await Bun.sleep(120);

      rightCommand.close();
      rightStream.close();

      await Bun.sleep(120);

      const startedAt = Date.now();
      const ackPromise = left.broadcastWithAck(
        withMessageId({ kind: "event", event: "alive-only", data: true }),
        { pockets: ["alpha"], timeoutMs: 500 },
      );

      await waitFor(() => leftSocket.sent.length === 1);

      const frame = parseFrame(leftSocket.sent[0]!.data as string);
      await left.handleInboundFrame("left-1", createAckFrame(frame.id!, "left-ok"));

      const result = await ackPromise;

      expect(Date.now() - startedAt).toBeLessThan(400);
      expect(result).toEqual({
        expected: 1,
        received: 1,
        responses: ["left-ok"],
        timedOut: false,
      });
    } finally {
      await left.close();
      await right.close().catch(() => undefined);
      if (rightCommand.connected) {
        rightCommand.close();
      }
      if (rightStream.connected) {
        rightStream.close();
      }
      await cleanupRedisTestScope(leftCommand, scope);
    }
  });

  test("removes graceful shutdown nodes immediately via adapter close message", async () => {
    if (!redisAvailable) {
      return;
    }

    const rightCommand = await createRedisClient();
    const rightStream = await duplicateRedisClient(rightCommand);
    const left = new RedisEmulsifier(
      {
        uid: createRedisNodeId("left-graceful"),
        commandClient: leftCommand,
        streamClient: leftStream,
        streamName: scope.streamName,
        heartbeatIntervalMs: 25,
        heartbeatTimeoutMs: 150,
      },
      { scope: scope.name },
    );
    const right = new RedisEmulsifier(
      {
        uid: createRedisNodeId("right-graceful"),
        commandClient: rightCommand,
        streamClient: rightStream,
        streamName: scope.streamName,
        heartbeatIntervalMs: 25,
        heartbeatTimeoutMs: 150,
      },
      { scope: scope.name },
    );

    try {
      const leftSocket = createFakeServerWebSocket({ socketId: "left-graceful-1" });

      left.addSocket(
        createSocketContext({ socketId: "left-graceful-1", ws: leftSocket.ws }),
      );
      await left.join("left-graceful-1", ["alpha"]);
      await Bun.sleep(100);

      await right.close();
      await Bun.sleep(40);

      const ackPromise = left.broadcastWithAck(
        withMessageId({ kind: "event", event: "graceful-only", data: true }),
        { pockets: ["alpha"], timeoutMs: 300 },
      );

      await waitFor(() => leftSocket.sent.length === 1);

      const frame = parseFrame(leftSocket.sent[0]!.data as string);
      await left.handleInboundFrame(
        "left-graceful-1",
        createAckFrame(frame.id!, "left-graceful-ok"),
      );

      await expect(ackPromise).resolves.toEqual({
        expected: 1,
        received: 1,
        responses: ["left-graceful-ok"],
        timedOut: false,
      });
    } finally {
      await left.close();
      if (rightCommand.connected) {
        rightCommand.close();
      }
      if (rightStream.connected) {
        rightStream.close();
      }
      await cleanupRedisTestScope(leftCommand, scope);
    }
  });
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1_000,
  intervalMs = 10,
): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for condition.`);
    }

    await Bun.sleep(intervalMs);
  }
}
