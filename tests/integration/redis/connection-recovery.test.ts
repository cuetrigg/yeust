import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { RedisEmulsifier } from "../../../src/emulsifiers/redis/index.ts";
import { parseFrame, withMessageId } from "../../../src/protocol/frames.ts";
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

const scope = createRedisTestScope("yeust-recovery-success");

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

describe("RedisEmulsifier connection recovery", () => {
  test("restores a disconnected session and replays missed frames on another node", async () => {
    if (!redisAvailable) {
      return;
    }

    const left = new RedisEmulsifier(
      {
        uid: createRedisNodeId("left"),
        commandClient: leftCommand,
        streamClient: leftStream,
        streamName: scope.streamName,
        sessionTtlMs: 1_000,
      },
      { scope: scope.name },
    );
    const right = new RedisEmulsifier(
      {
        uid: createRedisNodeId("right"),
        commandClient: rightCommand,
        streamClient: rightStream,
        streamName: scope.streamName,
        sessionTtlMs: 1_000,
      },
      { scope: scope.name },
    );

    try {
      const leftSocket = createFakeServerWebSocket({ socketId: "left-1" });
      const sessionId = "session-success-1";

      left.addSocket(
        createSocketContext({
          socketId: "left-1",
          sessionId,
          ws: leftSocket.ws,
          data: { userId: "u-1" },
        }),
      );
      await left.join("left-1", ["alpha"]);
      await Bun.sleep(50);

      await right.broadcast(
        withMessageId({ kind: "event", event: "before-disconnect", data: 1 }),
        { pockets: ["alpha"] },
      );

      await waitFor(() => leftSocket.sent.length === 1);

      const delivered = parseFrame(leftSocket.sent[0]!.data as string);
      const offset = delivered.offset;

      expect(offset).toBeString();

      await left.removeSocket("left-1");

      await right.broadcast(
        withMessageId({ kind: "event", event: "missed-1", data: 2 }),
        { pockets: ["alpha"] },
      );
      await right.broadcast(
        withMessageId({ kind: "event", event: "missed-2", data: 3 }),
        { pockets: ["alpha"] },
      );

      const recovered = await right.restoreSession(sessionId, offset!);

      expect(recovered).not.toBeNull();
      expect(recovered?.pockets).toEqual(["alpha"]);
      expect(recovered?.data).toEqual({ userId: "u-1" });
      expect(recovered?.missedFrames).toHaveLength(2);
      expect(recovered?.missedFrames.map((frame) => frame.event)).toEqual([
        "missed-1",
        "missed-2",
      ]);
      expect(recovered?.missedFrames[0]?.offset).toBeString();
      expect(recovered?.missedFrames[1]?.offset).toBeString();
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
