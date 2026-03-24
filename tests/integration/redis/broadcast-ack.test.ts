import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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

const scope = createRedisTestScope("yeust-ack-test");

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

describe("RedisEmulsifier broadcast acknowledgements", () => {
  test("aggregates acknowledgements across nodes", async () => {
    if (!redisAvailable) {
      return;
    }

    const left = createNode("left", leftCommand, leftStream);
    const right = createNode("right", rightCommand, rightStream);

    try {
      const leftSocket = createFakeServerWebSocket({ socketId: "left-1" });
      const rightSocket = createFakeServerWebSocket({ socketId: "right-1" });

      left.addSocket(createSocketContext({ socketId: "left-1", ws: leftSocket.ws }));
      right.addSocket(createSocketContext({ socketId: "right-1", ws: rightSocket.ws }));

      await left.join("left-1", ["alpha"]);
      await right.join("right-1", ["alpha"]);
      await Bun.sleep(50);

      const ackPromise = left.broadcastWithAck(
        withMessageId({ kind: "event", event: "needs-ack", data: { ok: true } }),
        { pockets: ["alpha"], timeoutMs: 500 },
      );

      await waitFor(() => leftSocket.sent.length === 1 && rightSocket.sent.length === 1);

      const leftFrame = parseFrame(leftSocket.sent[0]!.data as string);
      const rightFrame = parseFrame(rightSocket.sent[0]!.data as string);

      await left.handleInboundFrame("left-1", createAckFrame(leftFrame.id!, "left-ok"));
      await right.handleInboundFrame("right-1", createAckFrame(rightFrame.id!, "right-ok"));

      const result = await ackPromise;

      expect(result.expected).toBe(2);
      expect(result.received).toBe(2);
      expect(result.timedOut).toBe(false);
      expect(result.responses).toEqual(expect.arrayContaining(["left-ok", "right-ok"]));
    } finally {
      await left.close();
      await right.close();
      await cleanupRedisTestScope(leftCommand, scope);
    }
  });

  test("returns partial results when acknowledgements time out", async () => {
    if (!redisAvailable) {
      return;
    }

    const left = createNode("left-timeout", leftCommand, leftStream);
    const right = createNode("right-timeout", rightCommand, rightStream);

    try {
      const leftSocket = createFakeServerWebSocket({ socketId: "left-timeout-1" });
      const rightSocket = createFakeServerWebSocket({ socketId: "right-timeout-1" });

      left.addSocket(
        createSocketContext({ socketId: "left-timeout-1", ws: leftSocket.ws }),
      );
      right.addSocket(
        createSocketContext({ socketId: "right-timeout-1", ws: rightSocket.ws }),
      );

      await left.join("left-timeout-1", ["alpha"]);
      await right.join("right-timeout-1", ["alpha"]);
      await Bun.sleep(50);

      const ackPromise = left.broadcastWithAck(
        withMessageId({ kind: "event", event: "needs-ack-timeout", data: { ok: true } }),
        { pockets: ["alpha"], timeoutMs: 100 },
      );

      await waitFor(() => leftSocket.sent.length === 1 && rightSocket.sent.length === 1);

      const leftFrame = parseFrame(leftSocket.sent[0]!.data as string);
      await left.handleInboundFrame(
        "left-timeout-1",
        createAckFrame(leftFrame.id!, "left-only"),
      );

      const result = await ackPromise;

      expect(result.expected).toBe(2);
      expect(result.received).toBe(1);
      expect(result.timedOut).toBe(true);
      expect(result.responses).toEqual(["left-only"]);
    } finally {
      await left.close();
      await right.close();
      await cleanupRedisTestScope(leftCommand, scope);
    }
  });
});

function createNode(
  label: string,
  commandClient: Awaited<ReturnType<typeof createRedisClient>>,
  streamClient: Awaited<ReturnType<typeof duplicateRedisClient>>,
): RedisEmulsifier {
  return new RedisEmulsifier(
    {
      uid: createRedisNodeId(label),
      commandClient,
      streamClient,
      streamName: scope.streamName,
    },
    { scope: scope.name },
  );
}

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
