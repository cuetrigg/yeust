import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { RedisEmulsifier } from "../../../src/emulsifiers/redis/index.ts";
import { createSocketContext } from "../../../src/sockets/context.ts";
import { parseFrame, withMessageId } from "../../../src/protocol/frames.ts";
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

const scope = createRedisTestScope();

let redisAvailable = false;

let leftCommand: Awaited<ReturnType<typeof createRedisClient>>;
let leftStream: Awaited<ReturnType<typeof duplicateRedisClient>>;
let rightCommand: Awaited<ReturnType<typeof createRedisClient>>;
let rightStream: Awaited<ReturnType<typeof duplicateRedisClient>>;

beforeAll(async () => {
  try {
    await waitForRedis(getRedisUrl(), 5, 50);
    redisAvailable = true;
    leftCommand = await createRedisClient();
    leftStream = await duplicateRedisClient(leftCommand);
    rightCommand = await createRedisClient();
    rightStream = await duplicateRedisClient(rightCommand);
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
  rightStream.close();
  rightCommand.close();
});

describe("RedisEmulsifier clustered pockets", () => {
  test("broadcasts to matching sockets across nodes and respects except pockets", async () => {
    if (!redisAvailable) {
      return;
    }

    const left = new RedisEmulsifier(
      {
        uid: createRedisNodeId("left"),
        commandClient: leftCommand,
        streamClient: leftStream,
        streamName: scope.streamName,
      },
      { scope: scope.name },
    );
    const right = new RedisEmulsifier(
      {
        uid: createRedisNodeId("right"),
        commandClient: rightCommand,
        streamClient: rightStream,
        streamName: scope.streamName,
      },
      { scope: scope.name },
    );

    try {
      const leftSocket = createFakeServerWebSocket({ socketId: "left-1" });
      const rightSocket = createFakeServerWebSocket({ socketId: "right-1" });
      const ignoredSocket = createFakeServerWebSocket({ socketId: "right-2" });

      left.addSocket(
        createSocketContext({ socketId: "left-1", ws: leftSocket.ws }),
      );
      right.addSocket(
        createSocketContext({ socketId: "right-1", ws: rightSocket.ws }),
      );
      right.addSocket(
        createSocketContext({ socketId: "right-2", ws: ignoredSocket.ws }),
      );

      await left.join("left-1", ["alpha"]);
      await right.join("right-1", ["alpha"]);
      await right.join("right-2", ["alpha", "ignore"]);

      await Bun.sleep(50);

      await left.broadcast(
        withMessageId({
          kind: "event",
          event: "cluster:greeting",
          data: { from: "left" },
        }),
        { pockets: ["alpha"], except: ["ignore"] },
      );

      await waitFor(() =>
        leftSocket.sent.length === 1 && rightSocket.sent.length === 1,
      );

      expect(ignoredSocket.sent).toHaveLength(0);
      expect(parseFrame(leftSocket.sent[0]!.data as string)).toMatchObject({
        event: "cluster:greeting",
        data: { from: "left" },
      });
      expect(parseFrame(rightSocket.sent[0]!.data as string)).toMatchObject({
        event: "cluster:greeting",
        data: { from: "left" },
      });
    } finally {
      await left.close();
      await right.close();
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
