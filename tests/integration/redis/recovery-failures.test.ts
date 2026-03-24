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

let redisAvailable = false;
let commandClient: Awaited<ReturnType<typeof createRedisClient>>;
let streamClient: Awaited<ReturnType<typeof duplicateRedisClient>>;

beforeAll(async () => {
  try {
    await waitForRedis(getRedisUrl(), 5, 50);
    redisAvailable = true;
    commandClient = await createRedisClient();
    streamClient = await duplicateRedisClient(commandClient);
  } catch {
    redisAvailable = false;
  }
});

afterAll(async () => {
  if (!redisAvailable) {
    return;
  }

  streamClient.close();
  commandClient.close();
});

describe("RedisEmulsifier recovery failures", () => {
  test("returns null when the session has expired", async () => {
    if (!redisAvailable) {
      return;
    }

    const scope = createRedisTestScope("yeust-recovery-expired");
    const emulsifier = new RedisEmulsifier(
      {
        uid: createRedisNodeId("expired"),
        commandClient,
        streamClient,
        streamName: scope.streamName,
        sessionTtlMs: 25,
      },
      { scope: scope.name },
    );

    try {
      const socket = createFakeServerWebSocket({ socketId: "expired-1" });

      emulsifier.addSocket(
        createSocketContext({
          socketId: "expired-1",
          sessionId: "expired-session-1",
          ws: socket.ws,
        }),
      );
      await emulsifier.join("expired-1", ["alpha"]);

      await emulsifier.broadcast(
        withMessageId({ kind: "event", event: "seed", data: 1 }),
        { pockets: ["alpha"] },
      );

      await waitFor(() => socket.sent.length === 1);

      const offset = parseFrame(socket.sent[0]!.data as string).offset!;
      await emulsifier.removeSocket("expired-1");
      await Bun.sleep(60);

      await expect(
        emulsifier.restoreSession("expired-session-1", offset),
      ).resolves.toBeNull();
    } finally {
      await emulsifier.close();
      await cleanupRedisTestScope(commandClient, scope);
    }
  });

  test("returns null when the provided offset was trimmed from the stream", async () => {
    if (!redisAvailable) {
      return;
    }

    const scope = createRedisTestScope("yeust-recovery-trimmed");
    const emulsifier = new RedisEmulsifier(
      {
        uid: createRedisNodeId("trimmed"),
        commandClient,
        streamClient,
        streamName: scope.streamName,
        sessionTtlMs: 1_000,
      },
      { scope: scope.name },
    );

    try {
      const socket = createFakeServerWebSocket({ socketId: "trimmed-1" });

      emulsifier.addSocket(
        createSocketContext({
          socketId: "trimmed-1",
          sessionId: "trimmed-session-1",
          ws: socket.ws,
        }),
      );
      await emulsifier.join("trimmed-1", ["alpha"]);

      await emulsifier.broadcast(
        withMessageId({ kind: "event", event: "seed", data: 1 }),
        { pockets: ["alpha"] },
      );

      await waitFor(() => socket.sent.length === 1);

      const offset = parseFrame(socket.sent[0]!.data as string).offset!;
      await emulsifier.removeSocket("trimmed-1");
      await emulsifier.broadcast(
        withMessageId({ kind: "event", event: "later-1", data: 2 }),
        { pockets: ["alpha"] },
      );
      await emulsifier.broadcast(
        withMessageId({ kind: "event", event: "later-2", data: 3 }),
        { pockets: ["alpha"] },
      );
      await commandClient.send("XTRIM", [scope.streamName, "MAXLEN", "=", "1"]);

      await expect(
        emulsifier.restoreSession("trimmed-session-1", offset),
      ).resolves.toBeNull();
    } finally {
      await emulsifier.close();
      await cleanupRedisTestScope(commandClient, scope);
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
